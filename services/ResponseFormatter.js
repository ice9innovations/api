/**
 * ResponseFormatter - Service for creating compact API responses
 * Removes duplication and bloat from ML service results while preserving functionality
 */

class ResponseFormatter {
    /**
     * Create compact bounding boxes by removing redundant data
     * @param {Object} boundingBoxData - Full bounding box data from BoundingBoxService
     * @returns {Array} Compact bounding box array
     */
    createCompactBoundingBoxes(boundingBoxData) {
        if (!boundingBoxData?.all_detections) return [];
        
        return boundingBoxData.all_detections.map(detection => ({
            emoji: detection.emoji,
            label: detection.label,
            service: detection.service,
            bbox: detection.bbox, // Remove original_bbox duplicate
            confidence: detection.confidence,
            type: detection.type
            // Removed: original_bbox, processing_dimensions, display_dimensions (duplicates)
        }));
    }

    /**
     * Create compact results with timing data
     * @param {Object} results - Full results from ML services
     * @param {Array} serviceStatusList - Service status with timing data
     * @returns {Object} Compact results object
     */
    createCompactResults(results, serviceStatusList = []) {
        const compact = {};
        
        // Create lookup for timing data
        const timingLookup = {};
        serviceStatusList.forEach(status => {
            timingLookup[status.service] = {
                status: status.status,
                processing_time: status.time,
                prediction_count: status.predictions
            };
        });
        
        Object.entries(results).forEach(([serviceName, result]) => {
            if (result?.predictions) {
                const timing = timingLookup[serviceName] || {};
                
                // Use predictions as-is (caption scoring handled by CaptionAggregationService)
                const enhancedPredictions = result.predictions;
                
                // Processing time is already in seconds from V3 services
                const processingTimeSeconds = timing.processing_time || 
                    (result.metadata?.processing_time || 0);
                
                compact[serviceName] = {
                    success: result.success,
                    status: timing.status || (result.success ? 'success' : 'error'),
                    predictions: enhancedPredictions,
                    metadata: {
                        ...result.metadata,
                        processing_time: processingTimeSeconds
                    }
                };
            }
        });
        
        // Return alphabetically sorted results for consistent API responses
        const sortedCompact = {};
        Object.keys(compact).sort().forEach(key => {
            sortedCompact[key] = compact[key];
        });
        
        return sortedCompact;
    }

    /**
     * Create compact winning objects structure
     * @param {Object} boundingBoxData - Full bounding box data
     * @returns {Array} Compact winning objects array
     */
    createCompactWinningObjects(boundingBoxData) {
        if (!boundingBoxData?.winning_objects?.grouped) return [];

        return Object.entries(boundingBoxData.winning_objects.grouped).map(([key, group]) => ({
            emoji: group.emoji,
            label: group.label,
            merged_bbox: group.merged_bbox,
            services: group.detections.reduce((acc, detection) => {
                acc[detection.service] = {
                    label: detection.label,
                    confidence: detection.confidence,
                    bbox: detection.bbox
                };
                return acc;
            }, {})
        }));
    }

    /**
     * Integrate bounding boxes into emoji predictions following "store with object" principle
     * @param {Object} emojiPredictions - Emoji predictions from voting
     * @param {Object} boundingBoxData - Bounding box data
     * @returns {Object} Enhanced emoji predictions with bounding boxes
     */
    integrateEmojiPredictionsWithBoundingBoxes(emojiPredictions, boundingBoxData) {
        if (!boundingBoxData?.winning_objects?.grouped) {
            return emojiPredictions;
        }

        // Create lookup for bounding box data by emoji (supporting multiple clusters and instances)
        const bboxLookup = {};
        Object.entries(boundingBoxData.winning_objects.grouped).forEach(([key, group]) => {
            bboxLookup[group.emoji] = {
                clusters: group.clusters || [], // Multiple clusters if available
                instances: group.instances || [], // Cross-service instances with instance_id tracking
                bbox_services: group.detections.reduce((acc, detection) => {
                    acc[detection.service] = {
                        bbox: detection.bbox,
                        confidence: detection.confidence
                    };
                    return acc;
                }, {})
            };
        });

        // Enhance emoji predictions with bounding box data
        const enhanceEmojiList = (emojiList) => {
            return emojiList.map(emojiItem => {
                const bboxData = bboxLookup[emojiItem.emoji];
                if (!bboxData) return emojiItem;

                // Add multiple detection clusters
                const enhanced = {
                    ...emojiItem
                };

                // Add enhanced bounding boxes with cross-service clustering and instance tracking
                if (bboxData.instances && bboxData.instances.length > 0) {
                    // Use cross-service instances with new robust format
                    // Include ALL instance properties to preserve conditional processing enhancements
                    enhanced.bounding_boxes = bboxData.instances.map(instance => ({
                        cluster_id: instance.cluster_id,
                        merged_bbox: instance.merged_bbox,
                        emoji: instance.emoji,
                        label: instance.label,
                        detection_count: instance.detection_count,
                        avg_confidence: instance.avg_confidence,
                        detections: instance.detections,
                        // Include conditional processing enhancements (color_analysis, face_analysis, pose_analysis)
                        ...Object.fromEntries(
                            Object.entries(instance).filter(([key, value]) => 
                                key.endsWith('_analysis') && value != null
                            )
                        )
                    }));
                } else if (bboxData.clusters && bboxData.clusters.length > 0) {
                    // Fallback to original clusters format for backward compatibility
                    enhanced.bounding_boxes = bboxData.clusters.map(cluster => ({
                        cluster_id: cluster.cluster_id,
                        merged_bbox: cluster.merged_bbox,
                        detection_count: cluster.detection_count,
                        avg_confidence: Math.round(cluster.avg_confidence * 1000) / 1000,
                        services: cluster.services
                    }));
                }

                // Enhance services array with bounding box data
                enhanced.services = emojiItem.services.map(service => {
                    const serviceBbox = bboxData.bbox_services[service.name];
                    if (serviceBbox) {
                        return {
                            ...service,
                            bbox: serviceBbox.bbox
                        };
                    }
                    return service;
                });

                return enhanced;
            });
        };

        // Handle both V2 (first_place/second_place) and V3 (consensus) formats
        if (emojiPredictions.consensus) {
            // V3 format with consensus array
            return {
                consensus: enhanceEmojiList(emojiPredictions.consensus || [])
            };
        } else {
            // V2 format with first_place/second_place (backward compatibility)
            return {
                first_place: enhanceEmojiList(emojiPredictions.first_place || []),
                second_place: enhanceEmojiList(emojiPredictions.second_place || [])
            };
        }
    }

    /**
     * Create compact bounding box structure (deprecated - data now in emoji_predictions)
     * @param {Object} boundingBoxData - Full bounding box data
     * @returns {Object} Compact bounding box structure
     */
    createCompactBoundingBoxStructure(boundingBoxData) {
        return {
            all_detections: this.createCompactBoundingBoxes(boundingBoxData),
            winning_objects: this.createCompactWinningObjects(boundingBoxData),
            metadata: boundingBoxData.metadata
        };
    }


    /**
     * Create full compact response
     * @param {Object} params - Parameters for response creation
     * @param {string} params.imageId - Unique image identifier
     * @param {number} params.analysisTime - Analysis time in seconds
     * @param {Object} params.imageDimensions - Image width/height
     * @param {string} params.imageUrl - URL to processed image (if applicable)
     * @param {string} params.filePath - File path (if applicable)
     * @param {string} params.processingMethod - How the image was provided
     * @param {boolean} params.isFileUpload - Whether image was uploaded vs URL
     * @param {string} params.originalUrl - Original URL if external image
     * @param {Array} params.serviceStatusList - Individual service statuses
     * @param {Object} params.votingResults - Emoji voting results
     * @param {Object} params.captionsData - Unified caption aggregation results
     * @param {Object} params.boundingBoxData - Bounding box data
     * @param {Object} params.conditionalData - Conditional processing results
     * @param {Object} params.results - Raw ML service results
     * @returns {Object} Compact response object
     */
    createCompactResponse({
        imageId,
        analysisTime,
        imageDimensions,
        imageUrl,
        filePath,
        processingMethod,
        isFileUpload,
        originalUrl,
        serviceStatusList,
        votingResults,
        captionsData,
        boundingBoxData,
        conditionalData,
        results,
        healthSummary = null
    }) {
        const imageData = {
            image_dimensions: imageDimensions ? {
                width: imageDimensions.width,
                height: imageDimensions.height
            } : null,
            processing_method: processingMethod
        };

        // Add appropriate URL or file path based on processing method
        if (imageUrl) {
            imageData.image_url = imageUrl;
        }
        if (filePath) {
            imageData.file_path = filePath;
        }
        if (originalUrl) {
            imageData.original_url = originalUrl;
        }

        // Determine success based on service health - fail fast when services are offline
        const hasOfflineServices = healthSummary && healthSummary.degraded_services && 
            healthSummary.degraded_services.length > 0;
        
        const response = {
            success: !hasOfflineServices,
            image_id: imageId,
            analysis_time: Math.round(analysisTime * 1000) / 1000,
            image_data: imageData,
            votes: {
                ...this.integrateEmojiPredictionsWithBoundingBoxes(votingResults.votes, boundingBoxData)
            },
            special: votingResults.special || {},
            ...captionsData,
            results: this.createCompactResults(results, serviceStatusList)
        };

        
        // Add health summary if services are degraded
        if (healthSummary) {
            response.service_health_summary = healthSummary;
            if (hasOfflineServices) {
                response.error = `${healthSummary.failed_count} service(s) offline: ${healthSummary.degraded_services.join(', ')}`;
            }
        }
        
        return response;
    }
}

module.exports = ResponseFormatter;