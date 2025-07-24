/**
 * Bounding Box Processing Service
 * Handles coordinate scaling and semantic grouping for bounding boxes
 */

class BoundingBoxService {
    constructor() {
        // No configuration needed - ML services provide complete data
    }

    /**
     * Process all bounding boxes from ML service results
     * @param {Object} results - ML service results
     * @param {Object} imageDimensions - Original image dimensions
     * @param {Object} winningEmojis - Array of winning emojis
     * @returns {Object} Processed bounding box data
     */
    async processBoundingBoxes(results, imageDimensions, winningEmojis = []) {
        const allDetections = [];
        const winningObjects = [];

        // Process each ML service that supports bounding boxes
        const bboxServices = ['yolo', 'detectron2', 'rtdetr', 'face'];
        
        for (const serviceName of bboxServices) {
            const serviceData = results[serviceName];
            if (!serviceData?.data?.predictions?.length || !serviceData?.metadata?.image_dimensions) {
                continue;
            }

            const predictions = serviceData.data.predictions;
            const processingDimensions = serviceData.metadata.image_dimensions;

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

                // Check if this is a winning object
                const isWinningObject = prediction.emoji && winningEmojis.includes(prediction.emoji);
                const isFace = prediction.type === 'face_detection';
                
                if (isWinningObject || isFace) {
                    winningObjects.push(processedDetection);
                }
            }
        }

        // Group winning objects by label for semantic grouping
        const groupedWinningObjects = this.groupByLabel(winningObjects);

        return {
            all_detections: allDetections,
            winning_objects: {
                individual: winningObjects,
                grouped: groupedWinningObjects
            },
            metadata: {
                total_detections: allDetections.length,
                winning_detections: winningObjects.length,
                grouped_objects: Object.keys(groupedWinningObjects).length,
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
     * Group detections by label and create multiple merged bounding boxes per label
     * @param {Array} detections - Array of detection objects
     * @returns {Object} Grouped detections with multiple merged bounding boxes
     */
    groupByLabel(detections) {
        const groups = {};

        detections.forEach(detection => {
            const key = detection.type === 'face_detection' ? 'face' : detection.label;
            if (!groups[key]) {
                groups[key] = {
                    label: detection.label,
                    emoji: detection.emoji,
                    type: detection.type,
                    detections: [],
                    clusters: []
                };
            }
            groups[key].detections.push(detection);
        });

        // Create multiple clusters per group instead of single merged box
        Object.values(groups).forEach(group => {
            if (group.detections.length > 0) {
                group.clusters = this.createMultipleClusters(group.detections);
                // Keep merged_bbox as the largest cluster for backward compatibility
                group.merged_bbox = group.clusters.length > 0 ? group.clusters[0].merged_bbox : null;
            }
        });

        return groups;
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