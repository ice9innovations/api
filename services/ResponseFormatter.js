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
     * Create compact results with timing data and caption scoring included
     * @param {Object} results - Full results from ML services
     * @param {Array} serviceStatusList - Service status with timing data
     * @param {Object} captionScores - Caption scoring data to merge
     * @returns {Object} Compact results object
     */
    createCompactResults(results, serviceStatusList = [], captionScores = {}) {
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
            if (result?.data?.predictions) {
                const timing = timingLookup[serviceName] || {};
                
                // Process predictions and merge caption scores
                const enhancedPredictions = result.data.predictions.map(prediction => {
                    if (prediction.type === 'caption') {
                        // Check if we have scoring data for this service
                        const serviceKey = serviceName === 'ollama' ? 'llama' : serviceName;
                        const scoreData = captionScores[serviceKey];
                        
                        if (scoreData) {
                            return {
                                ...prediction,
                                score: {
                                    raw_score: scoreData.raw_score,
                                    score: scoreData.score,
                                    matches: scoreData.matches,
                                    words: scoreData.words,
                                    total_words: scoreData.total_words,
                                    percentage: scoreData.percentage,
                                    formatted: scoreData.formatted
                                }
                            };
                        }
                    }
                    return prediction;
                });
                
                // Ensure processing time is in seconds and only in metadata
                const processingTimeSeconds = timing.processing_time ? 
                    timing.processing_time / 1000 : 
                    (result.data.metadata?.processing_time || 0);
                
                compact[serviceName] = {
                    success: result.success,
                    status: timing.status || (result.success ? 'success' : 'error'),
                    prediction_count: timing.prediction_count || result.data.predictions.length,
                    predictions: enhancedPredictions,
                    metadata: {
                        ...result.data.metadata,
                        processing_time: processingTimeSeconds
                    }
                };
            }
        });
        
        return compact;
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

        // Create lookup for bounding box data by emoji (supporting multiple clusters)
        const bboxLookup = {};
        Object.entries(boundingBoxData.winning_objects.grouped).forEach(([key, group]) => {
            bboxLookup[group.emoji] = {
                merged_bbox: group.merged_bbox, // Primary/largest cluster for backward compatibility
                clusters: group.clusters || [], // Multiple clusters if available
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

                // Add merged bounding box and multiple clusters
                const enhanced = {
                    ...emojiItem,
                    merged_bbox: bboxData.merged_bbox
                };

                // Add multiple detection clusters if available
                if (bboxData.clusters && bboxData.clusters.length > 0) {
                    enhanced.detection_clusters = bboxData.clusters.map(cluster => ({
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

        return {
            first_place: enhanceEmojiList(emojiPredictions.first_place || []),
            second_place: enhanceEmojiList(emojiPredictions.second_place || [])
        };
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
     * @param {string} params.imageUrl - URL to processed image
     * @param {boolean} params.isFileUpload - Whether image was uploaded vs URL
     * @param {string} params.originalUrl - Original URL if external image
     * @param {Array} params.serviceStatusList - Individual service statuses
     * @param {Object} params.votingResults - Emoji voting results
     * @param {Object} params.captions - Caption results
     * @param {Object} params.captionScores - Caption scoring results
     * @param {Object} params.boundingBoxData - Bounding box data
     * @param {Object} params.results - Raw ML service results
     * @returns {Object} Compact response object
     */
    createCompactResponse({
        imageId,
        analysisTime,
        imageDimensions,
        imageUrl,
        isFileUpload,
        originalUrl,
        serviceStatusList,
        votingResults,
        captions,
        captionScores,
        boundingBoxData,
        results,
        healthSummary = null
    }) {
        const response = {
            success: true,
            image_id: imageId,
            analysis_time: analysisTime,
            image_data: {
                image_dimensions: imageDimensions ? {
                    width: imageDimensions.width,
                    height: imageDimensions.height
                } : null,
                image_url: imageUrl,
                processing_method: isFileUpload ? 'file_upload' : 'external_url_downloaded',
                original_url: originalUrl
            },
            emoji_predictions: {
                ...this.integrateEmojiPredictionsWithBoundingBoxes(votingResults.emoji_predictions, boundingBoxData)
            },
            captions: captions,
            results: this.createCompactResults(results, serviceStatusList, captionScores)
        };
        
        // Add health summary if services are degraded
        if (healthSummary) {
            response.service_health_summary = healthSummary;
        }
        
        return response;
    }
}

module.exports = ResponseFormatter;