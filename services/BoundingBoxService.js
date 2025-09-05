/**
 * Bounding Box Processing Service
 * Handles coordinate scaling and semantic grouping for bounding boxes
 */

const { normalizeEmoji } = require('../utils/emojiUtils');

class BoundingBoxService {
    constructor() {
        // No configuration needed - ML services provide complete data
    }

    /**
     * Process all bounding boxes from ML service results
     * @param {Object} results - ML service results
     * @param {Object} imageDimensions - Original image dimensions
     * @param {Array} winningEmojis - Array of winning emojis (DEPRECATED - now processes ALL)
     * @returns {Object} Processed bounding box data
     */
    async processBoundingBoxes(results, imageDimensions, winningEmojis = []) {
        const allDetections = [];

        console.log(`🎯 BoundingBoxService: Processing ALL detections (no emoji filtering)`);

        // Process each ML service that supports bounding boxes
        const bboxServices = ['yolo', 'detectron2', 'rtdetr', 'yolo_365', 'yolo_oi7', 'face', 'clip', 'inception'];
        
        for (const serviceName of bboxServices) {
            const serviceData = results[serviceName];
            // Updated for V3 format: predictions are directly under serviceData, not serviceData.data
            if (!serviceData?.predictions?.length) {
                console.log(`🔍 BoundingBoxService: No predictions for ${serviceName}`);
                continue;
            }
            
            const predictions = serviceData.predictions;
            // V3 services don't provide image_dimensions in metadata anymore
            // Use the original imageDimensions since V3 services should return coordinates in original scale
            const processingDimensions = imageDimensions;

            for (const prediction of predictions) {
                if (!prediction.bbox) continue;

                // Scale coordinates to original image dimensions
                const scaledBbox = this.scaleCoordinates(
                    prediction.bbox,
                    processingDimensions,
                    imageDimensions
                );

                const processedDetection = {
                    service: serviceName,
                    label: prediction.label,
                    emoji: prediction.emoji,
                    bbox: scaledBbox,
                    original_bbox: prediction.bbox,
                    confidence: prediction.confidence,
                    type: prediction.type,
                    processing_dimensions: processingDimensions,
                    display_dimensions: imageDimensions
                };

                allDetections.push(processedDetection);
            }
        }

        // Group ALL objects by label for semantic grouping WITH cross-service clustering
        const groupedAllObjects = this.groupByLabelWithCrossServiceClustering(allDetections);

        return {
            all_detections: allDetections,
            winning_objects: {
                individual: allDetections, // All detections are now available
                grouped: groupedAllObjects
            },
            metadata: {
                total_detections: allDetections.length,
                winning_detections: allDetections.length, // All detections processed
                grouped_objects: Object.keys(groupedAllObjects).length,
                original_image_dimensions: imageDimensions
            }
        };
    }

    /**
     * Scale coordinates from processing dimensions to display dimensions
     * @param {Object} bbox - Original bounding box
     * @param {Object} processingDimensions - Dimensions image was processed at
     * @param {Object} displayDimensions - Target display dimensions
     * @returns {Object} Scaled bounding box
     */
    scaleCoordinates(bbox, processingDimensions, displayDimensions) {
        const scaleX = displayDimensions.width / processingDimensions.width;
        const scaleY = displayDimensions.height / processingDimensions.height;

        return {
            x: Math.round(bbox.x * scaleX),
            y: Math.round(bbox.y * scaleY),
            width: Math.round(bbox.width * scaleX),
            height: Math.round(bbox.height * scaleY)
        };
    }


    /**
     * Group detections by label with cross-service clustering to support multiple instances per emoji
     * This is the enhanced version that implements the bounding box clustering aggregation
     * @param {Array} detections - Array of detection objects from all services
     * @returns {Object} Grouped detections with cross-service clustering and instance tracking
     */
    groupByLabelWithCrossServiceClustering(detections) {
        const groups = {};

        // Step 1: Group all detections by emoji/label with normalization
        detections.forEach(detection => {
            const rawKey = detection.type === 'face_detection' ? 'face' : detection.emoji;
            const key = normalizeEmoji(rawKey);
            if (!groups[key]) {
                groups[key] = {
                    label: detection.label,
                    emoji: detection.emoji,
                    type: detection.type,
                    detections: [],
                    clusters: [],
                    instances: [] // NEW: Multiple instances per emoji
                };
            }
            groups[key].detections.push(detection);
        });

        // Step 2: For each emoji group, perform cross-service clustering
        Object.values(groups).forEach(group => {
            if (group.detections.length > 0) {
                // Perform cross-service clustering to identify multiple instances
                group.instances = this.createCrossServiceInstances(group.detections, group.emoji);
                
                // Keep existing clusters for backward compatibility
                group.clusters = this.createMultipleClusters(group.detections);
            }
        });

        return groups;
    }

    /**
     * Create cross-service instances for multiple objects of the same emoji type
     * This implements the core bounding box clustering aggregation algorithm
     * @param {Array} detections - Array of detection objects from all services for same emoji
     * @param {String} emoji - The emoji being processed
     * @returns {Array} Array of instance objects with cross-service clustering
     */
    createCrossServiceInstances(detections, emoji) {
        if (detections.length === 0) return [];

        // Cross-service clustering: Group detections that likely represent the same physical object
        const crossServiceClusters = this.findCrossServiceClusters(detections);
        
        // Sort clusters by score (best first) 
        crossServiceClusters.sort((a, b) => this.calculateClusterScore(b) - this.calculateClusterScore(a));

        // Filter and clean clusters before creating instances
        const cleanedClusters = crossServiceClusters
            .map(cluster => this.cleanCluster(cluster))
            .filter(cluster => cluster !== null);

        // Create instance objects with cross-service metadata
        return cleanedClusters.map((cluster, index) => {
            let mergedBbox;
            
            if (cluster.length === 1) {
                mergedBbox = cluster[0].bbox;
            } else {
                // Calculate encompassing bounding box for overlapping detections
                const boxes = cluster.map(d => d.bbox);
                const x1 = Math.min(...boxes.map(b => b.x));
                const y1 = Math.min(...boxes.map(b => b.y));
                const x2 = Math.max(...boxes.map(b => b.x + b.width));
                const y2 = Math.max(...boxes.map(b => b.y + b.height));

                mergedBbox = {
                    x: x1,
                    y: y1,
                    width: x2 - x1,
                    height: y2 - y1
                };
            }

            // Extract unique services and their confidence scores
            const contributingServices = [...new Set(cluster.map(d => d.service))];
            const confidenceScores = cluster.map(d => d.confidence);
            const avgConfidence = confidenceScores.reduce((sum, conf) => sum + conf, 0) / confidenceScores.length;

            // Generate instance ID for multiple objects of same type
            const baseLabel = cluster[0].label || emoji.slice(1, -1); // Remove emoji wrapper or use label
            const instanceId = `${baseLabel}_${index + 1}`;

            return {
                cluster_id: instanceId,
                emoji: emoji,
                label: cluster[0].label,
                merged_bbox: mergedBbox,
                detection_count: cluster.length,
                avg_confidence: Math.round(avgConfidence * 1000) / 1000,
                detections: cluster.map(detection => ({
                    service: detection.service,
                    confidence: detection.confidence
                }))
            };
        });
    }

    /**
     * Clean a cluster by removing same-service duplicates and filtering weak single-vote detections
     * @param {Array} cluster - Array of detection objects in cluster
     * @returns {Array|null} Cleaned cluster or null if cluster should be filtered out
     */
    cleanCluster(cluster) {
        if (!cluster || cluster.length === 0) return null;

        // Handle same-service duplicates (guaranteed bugs)
        const serviceGroups = {};
        cluster.forEach(detection => {
            const service = detection.service;
            if (!serviceGroups[service]) {
                serviceGroups[service] = [];
            }
            serviceGroups[service].push(detection);
        });

        // For each service, keep only the highest confidence detection
        const cleanedDetections = [];
        Object.entries(serviceGroups).forEach(([service, detections]) => {
            if (detections.length > 1) {
                console.warn(`Service ${service} has ${detections.length} detections in same cluster - keeping highest confidence`);
                // Keep highest confidence detection from this service
                const best = detections.reduce((a, b) => a.confidence > b.confidence ? a : b);
                cleanedDetections.push(best);
            } else {
                cleanedDetections.push(detections[0]);
            }
        });

        // Handle single-vote filtering (democratic consensus with high-confidence exception)
        if (cleanedDetections.length === 1) {
            const singleDetection = cleanedDetections[0];
            const CONFIDENCE_SHOUT_THRESHOLD = 0.85; // "But I'm right!" threshold
            
            if (singleDetection.confidence < CONFIDENCE_SHOUT_THRESHOLD) {
                console.log(`Filtering single low-confidence detection: ${singleDetection.service} ${singleDetection.confidence.toFixed(3)} (below ${CONFIDENCE_SHOUT_THRESHOLD})`);
                return null; // Democracy wins - filter it out
            } else {
                console.log(`Keeping high-confidence single detection: ${singleDetection.service} ${singleDetection.confidence.toFixed(3)} (pouting successfully!)`);
            }
        }

        return cleanedDetections;
    }

    /**
     * Find clusters of detections that represent the same physical object across services
     * Uses IoU overlap to identify same objects detected by multiple services
     * Avoids transitive clustering by requiring consensus overlap
     * @param {Array} detections - Array of detection objects from all services
     * @returns {Array} Array of clusters (each cluster contains detections of same physical object)
     */
    findCrossServiceClusters(detections) {
        const clusters = [];
        const used = new Set();

        for (let i = 0; i < detections.length; i++) {
            if (used.has(i)) continue;

            const cluster = [detections[i]];
            used.add(i);

            // Find all detections that have significant overlap with the INITIAL detection
            // This prevents transitive clustering where A→B→C get grouped when A and C don't overlap
            for (let j = i + 1; j < detections.length; j++) {
                if (used.has(j)) continue;

                // Check overlap with the INITIAL detection (not any detection in cluster)
                const overlapRatio = this.calculateOverlapRatio(detections[i].bbox, detections[j].bbox);
                
                if (overlapRatio > 0.3) {
                    cluster.push(detections[j]);
                    used.add(j);
                    console.log(`Cross-service cluster: ${detections[i].service} + ${detections[j].service} (IoU: ${overlapRatio.toFixed(3)})`);
                }
            }

            clusters.push(cluster);
        }

        return clusters;
    }

    /**
     * Create multiple clusters with merged bounding boxes for all detected object locations
     * @param {Array} detections - Array of detection objects with bbox and confidence
     * @returns {Array} Array of cluster objects with merged bounding boxes
     */
    createMultipleClusters(detections) {
        if (detections.length === 0) return [];

        const clusters = this.findOverlapClusters(detections);
        
        // Sort clusters by score (best first)
        clusters.sort((a, b) => this.calculateClusterScore(b) - this.calculateClusterScore(a));

        // Create cluster objects with merged bounding boxes
        return clusters.map((cluster, index) => {
            let mergedBbox;
            
            if (cluster.length === 1) {
                mergedBbox = cluster[0].bbox;
            } else {
                const boxes = cluster.map(d => d.bbox);
                const x1 = Math.min(...boxes.map(b => b.x));
                const y1 = Math.min(...boxes.map(b => b.y));
                const x2 = Math.max(...boxes.map(b => b.x + b.width));
                const y2 = Math.max(...boxes.map(b => b.y + b.height));

                mergedBbox = {
                    x: x1,
                    y: y1,
                    width: x2 - x1,
                    height: y2 - y1
                };
            }

            return {
                cluster_id: index,
                merged_bbox: mergedBbox,
                detections: cluster,
                detection_count: cluster.length,
                avg_confidence: cluster.reduce((sum, d) => sum + d.confidence, 0) / cluster.length,
                services: cluster.map(d => d.service)
            };
        });
    }

    /**
     * Create intelligent merged bounding box using cluster-based approach (legacy method)
     * @param {Array} detections - Array of detection objects with bbox and confidence
     * @returns {Object} Intelligently merged bounding box
     */
    createMinimumBoundingBox(detections) {
        const clusters = this.createMultipleClusters(detections);
        return clusters.length > 0 ? clusters[0].merged_bbox : null;
    }

    /**
     * Find clusters of overlapping detections
     * @param {Array} detections - Array of detection objects
     * @returns {Array} Array of clusters (each cluster is an array of detections)
     */
    findOverlapClusters(detections) {
        const clusters = [];
        const used = new Set();

        for (let i = 0; i < detections.length; i++) {
            if (used.has(i)) continue;

            const cluster = [detections[i]];
            used.add(i);

            // Find all detections that overlap with any detection in this cluster
            for (let j = i + 1; j < detections.length; j++) {
                if (used.has(j)) continue;

                const hasOverlap = cluster.some(clusterDetection => {
                    const overlapRatio = this.calculateOverlapRatio(clusterDetection.bbox, detections[j].bbox);
                    return overlapRatio > 0.05; // 5% overlap threshold
                });

                if (hasOverlap) {
                    cluster.push(detections[j]);
                    used.add(j);
                }
            }

            clusters.push(cluster);
        }

        return clusters;
    }

    /**
     * Calculate cluster score based on size, confidence, and bounding box area
     * @param {Array} cluster - Array of detections in cluster
     * @returns {number} Cluster score
     */
    calculateClusterScore(cluster) {
        // Score = (cluster size * 2) + (average confidence * 3) + (log average area * 1)
        // Favors larger clusters, high confidence, and larger bounding boxes
        const avgConfidence = cluster.reduce((sum, d) => sum + d.confidence, 0) / cluster.length;
        const avgArea = cluster.reduce((sum, d) => sum + (d.bbox.width * d.bbox.height), 0) / cluster.length;
        const logArea = Math.log10(Math.max(avgArea, 1)); // Prevent log(0)
        
        return (cluster.length * 2) + (avgConfidence * 3) + (logArea * 1);
    }

    /**
     * Calculate overlap ratio between two bounding boxes
     * @param {Object} box1 - First bounding box
     * @param {Object} box2 - Second bounding box
     * @returns {number} Overlap ratio (0-1)
     */
    calculateOverlapRatio(box1, box2) {
        const x1 = Math.max(box1.x, box2.x);
        const y1 = Math.max(box1.y, box2.y);
        const x2 = Math.min(box1.x + box1.width, box2.x + box2.width);
        const y2 = Math.min(box1.y + box1.height, box2.y + box2.height);

        if (x1 >= x2 || y1 >= y2) return 0; // No overlap

        const intersectionArea = (x2 - x1) * (y2 - y1);
        const box1Area = box1.width * box1.height;
        const box2Area = box2.width * box2.height;
        const unionArea = box1Area + box2Area - intersectionArea;

        return intersectionArea / unionArea; // IoU (Intersection over Union)
    }

}

module.exports = BoundingBoxService;