// Load V2VotingService for caption scoring (temporary delegation)
const V2VotingService = require('./V2VotingService');

/**
 * V3 Voting Service - handles native v3 service responses
 * Processes emoji predictions from v3 services without conversion layers
 */
class V3VotingService {
    constructor(options = {}) {
        this.serviceNames = {
            blip: 'blip',
            clip: 'clip', 
            yolo: 'yolo',
            colors: 'colors',
            detectron2: 'detectron2',
            face: 'face',
            nsfw: 'nsfw',
            ocr: 'ocr',
            inception: 'inception',
            rtdetr: 'rtdetr',
            metadata: 'metadata',
            ollama: 'llama',
            yolo_365: 'yolo_365',
            yolo_oi7: 'yolo_oi7'
        };
        
        // Special emojis that auto-promote to first place
        this.specialEmojis = ['🔞', '💬'];
        
        // Democratic voting configuration (no arbitrary thresholds)
        this.defaultConfidence = options.defaultConfidence || 0.75;   // Default confidence for services without scores
        this.lowConfidenceThreshold = options.lowConfidenceThreshold || 0.4; // For correlation validation
        
        // Pure democratic voting - no service weights
        // Evidence weighting will be calculated from actual detection data
    }

    /**
     * Main entry point - processes all service results and returns voting results
     */
    processVotes(serviceResults, boundingBoxData = null) {
        // Step 1: Extract all detections from all services
        const allDetections = this.extractAllDetections(serviceResults, boundingBoxData);
        
        // Step 2: Group detections by emoji (democratic voting)
        const emojiGroups = this.groupDetectionsByEmoji(allDetections);
        
        // Step 3: Analyze evidence for each emoji
        const emojiAnalysis = this.analyzeEmojiEvidence(emojiGroups, serviceResults);
        
        // Step 4: Calculate evidence weights and final ranking
        const rankedConsensus = this.calculateFinalRanking(emojiAnalysis);
        
        // Step 5: Apply post-processing curation (quality adjustments)
        this.applyPostProcessingCuration(rankedConsensus);
        
        return {
            votes: {
                consensus: rankedConsensus
            },
            special: this.extractSpecialDetections(serviceResults),
            debug: {
                detection_count: allDetections.length,
                emoji_groups: Object.keys(emojiGroups).length
            }
        };
    }

    /**
     * Extract all detections from all services with metadata
     */
    extractAllDetections(serviceResults, boundingBoxData = null) {
        const allDetections = [];

        Object.entries(serviceResults).forEach(([serviceName, result]) => {
            if (!result.success || !result.predictions) {
                return;
            }

            const serviceDisplayName = this.serviceNames[serviceName] || serviceName;
            const seenEmojis = new Set(); // Deduplicate within service

            result.predictions.forEach(prediction => {
                // Handle emoji_mappings format (BLIP, Ollama v3)
                if (prediction.emoji_mappings && Array.isArray(prediction.emoji_mappings)) {
                    prediction.emoji_mappings.forEach(mapping => {
                        if (mapping.emoji && !seenEmojis.has(mapping.emoji)) {
                            seenEmojis.add(mapping.emoji);
                            allDetections.push({
                                emoji: mapping.emoji,
                                service: serviceDisplayName,
                                evidence_type: this.getEvidenceType(serviceName),
                                confidence: this.defaultConfidence,
                                context: {
                                    word: mapping.word,
                                    source: 'caption_mapping'
                                },
                                shiny: mapping.shiny === true
                            });
                        }
                    });
                }
                // Handle direct emoji format (CLIP, object detection, etc.)
                else if (prediction.emoji && prediction.type !== 'color_analysis') {
                    const emoji = prediction.emoji;
                    
                    if (emoji && !seenEmojis.has(emoji)) {
                        seenEmojis.add(emoji);
                        allDetections.push({
                            emoji: emoji,
                            service: serviceDisplayName,
                            evidence_type: this.getEvidenceType(serviceName),
                            confidence: prediction.confidence || this.defaultConfidence,
                            context: this.extractContext(prediction, serviceName),
                            shiny: prediction.shiny === true
                        });
                    }
                }
            });

            // Note: Bounding box processing is now handled by BoundingBoxService
            // Individual service bounding boxes are not processed here to avoid duplication
        });
        
        // Extract spatial detections from clustered bounding box data (provided by BoundingBoxService)
        // Vote count = sum of detection_count across all instances (3 people > 1 chair)
        if (boundingBoxData?.winning_objects?.grouped) {
            Object.entries(boundingBoxData.winning_objects.grouped).forEach(([key, group]) => {
                if (group.emoji && group.instances) {
                    // Each instance gets votes equal to its detection_count
                    group.instances.forEach(instance => {
                        // Add spatial instance data (but don't create fake service votes)
                        allDetections.push({
                            emoji: group.emoji,
                            service: 'spatial_clustering', // Not a real service, just tracking spatial consensus
                            evidence_type: 'spatial',
                            confidence: instance.avg_confidence,
                            context: { source: 'clustered_bounding_box' },
                            shiny: false,
                            spatial_data: {
                                cluster_id: instance.cluster_id,
                                detection_count: instance.detection_count,
                                avg_confidence: instance.avg_confidence,
                                bbox: instance.merged_bbox,
                                individual_detections: instance.detections
                            }
                        });
                    });
                }
            });
        }

        return allDetections;
    }

    /**
     * Determine evidence type based on service name
     */
    getEvidenceType(serviceName) {
        const spatialServices = ['yolo', 'detectron2', 'rtdetr', 'yolo_365', 'yolo_oi7', 'clip', 'inception'];
        const semanticServices = ['blip', 'ollama']; // Smart captioning services
        const classificationServices = []; // No pure classification services - all upgraded to spatial
        const specializedServices = ['face', 'nsfw', 'ocr'];

        if (spatialServices.includes(serviceName)) return 'spatial';
        if (semanticServices.includes(serviceName)) return 'semantic';
        if (classificationServices.includes(serviceName)) return 'classification';
        if (specializedServices.includes(serviceName)) return 'specialized';
        return 'other';
    }

    /**
     * Extract context information from prediction
     */
    extractContext(prediction, serviceName) {
        const context = {};
        
        if (serviceName === 'face') {
            context.pose = prediction.pose || null;
        }
        if (serviceName === 'nsfw') {
            context.nsfw_confidence = prediction.confidence;
        }
        if (serviceName === 'ocr') {
            context.text_detected = prediction.has_text || false;
            context.text_content = prediction.text || null;
        }
        
        return context;
    }

    /**
     * Group detections by emoji for democratic voting
     */
    groupDetectionsByEmoji(allDetections) {
        const groups = {};
        
        allDetections.forEach(detection => {
            if (!groups[detection.emoji]) {
                groups[detection.emoji] = [];
            }
            groups[detection.emoji].push(detection);
        });
        
        return groups;
    }

    /**
     * OLD METHOD - Extract emoji votes from v3 service responses
     * TODO: Remove after transition complete
     */
    extractEmojiVotes_OLD(serviceResults) {
        const emojiVotes = {};

        Object.entries(serviceResults).forEach(([serviceName, result]) => {
            // V3 services have predictions directly, not wrapped in data
            if (!result.success || !result.predictions) {
                return;
            }

            const serviceDisplayName = this.serviceNames[serviceName] || serviceName;
            const seenEmojis = new Set(); // Deduplicate within service

            result.predictions.forEach(prediction => {
                let emoji = null;
                let confidence = prediction.confidence || this.defaultConfidence;

                // Handle emoji_mappings format (BLIP, Ollama v3)
                if (prediction.emoji_mappings && Array.isArray(prediction.emoji_mappings)) {
                    prediction.emoji_mappings.forEach(mapping => {
                        if (mapping.emoji && !seenEmojis.has(mapping.emoji)) {
                            seenEmojis.add(mapping.emoji);
                            this.addEmojiVote(emojiVotes, mapping.emoji, serviceDisplayName, this.defaultConfidence);
                        }
                    });
                }
                // Handle direct emoji format (CLIP, object detection, etc.)
                else if (prediction.emoji && prediction.type !== 'color_analysis') {
                    // Extract emoji from other prediction types
                    // Skip color_analysis predictions - they shouldn't participate in voting
                    emoji = prediction.emoji;
                    
                    if (emoji && !seenEmojis.has(emoji)) {
                        seenEmojis.add(emoji);
                        this.addEmojiVote(emojiVotes, emoji, serviceDisplayName, confidence);
                    }
                }
            });
        });

        return emojiVotes;
    }

    /**
     * Analyze evidence for each emoji group
     */
    analyzeEmojiEvidence(emojiGroups, serviceResults) {
        const analysis = [];
        
        Object.entries(emojiGroups).forEach(([emoji, detections]) => {
            const votingServices = [...new Set(detections.map(d => d.service).filter(s => s !== 'spatial_clustering'))];
            
            const evidenceAnalysis = {
                emoji: emoji,
                total_votes: votingServices.length,
                voting_services: votingServices,
                detections: detections,
                evidence: {
                    spatial: this.analyzeSpatialEvidence(detections),
                    semantic: this.analyzeSemanticEvidence(detections),
                    classification: this.analyzeClassificationEvidence(detections),
                    specialized: this.analyzeSpecializedEvidence(detections)
                },
                instances: this.extractInstanceInformation(detections),
                shiny: detections.some(d => d.shiny)
            };
            
            analysis.push(evidenceAnalysis);
        });
        
        return analysis;
    }

    /**
     * Analyze spatial evidence from object detection services
     * Now uses pre-clustered data from BoundingBoxService (no duplicate clustering)
     */
    analyzeSpatialEvidence(detections) {
        const spatialDetections = detections.filter(d => d.evidence_type === 'spatial');
        if (spatialDetections.length === 0) return null;
        
        const clusters = spatialDetections
            .filter(d => d.spatial_data)
            .map(d => d.spatial_data);
        
        if (clusters.length === 0) return null;
        
        return {
            service_count: spatialDetections.length,
            clusters: clusters,
            max_detection_count: Math.max(...clusters.map(c => c.detection_count)),
            avg_confidence: clusters.reduce((sum, c) => sum + c.avg_confidence, 0) / clusters.length,
            total_instances: clusters.length
        };
    }

    /**
     * Analyze semantic evidence from captioning services (BLIP, Ollama)
     */
    analyzeSemanticEvidence(detections) {
        const semanticDetections = detections.filter(d => d.evidence_type === 'semantic');
        if (semanticDetections.length === 0) return null;
        
        return {
            service_count: semanticDetections.length,
            words: semanticDetections.map(d => d.context.word).filter(Boolean),
            sources: semanticDetections.map(d => d.service)
        };
    }

    /**
     * Analyze classification evidence from image classification services (CLIP, Inception)
     */
    analyzeClassificationEvidence(detections) {
        const classificationDetections = detections.filter(d => d.evidence_type === 'classification');
        if (classificationDetections.length === 0) return null;
        
        return {
            service_count: classificationDetections.length,
            sources: classificationDetections.map(d => d.service)
        };
    }

    /**
     * Analyze specialized evidence (Face, NSFW, OCR)
     */
    analyzeSpecializedEvidence(detections) {
        const specializedDetections = detections.filter(d => d.evidence_type === 'specialized');
        if (specializedDetections.length === 0) return null;
        
        const byType = {};
        specializedDetections.forEach(d => {
            const serviceType = d.service.toLowerCase();
            if (!byType[serviceType]) byType[serviceType] = [];
            byType[serviceType].push(d);
        });
        
        return byType;
    }

    /**
     * Extract instance information (summary only - detailed data is in bounding_boxes)
     */
    extractInstanceInformation(detections) {
        const spatialDetections = detections.filter(d => d.spatial_data);
        
        if (spatialDetections.length === 0) {
            return { count: 1, type: 'non_spatial' };
        }
        
        // Return summary information only - detailed cluster data is in bounding_boxes
        return {
            count: spatialDetections.length,
            type: 'spatial'
        };
    }

    /**
     * Apply post-processing curation (quality adjustments)
     * Clean separation: democracy first, then editorial review
     */
    applyPostProcessingCuration(rankedConsensus) {
        // Build lookup for cross-emoji validation
        const emojiMap = {};
        rankedConsensus.forEach(item => {
            emojiMap[item.emoji] = item;
        });
        
        rankedConsensus.forEach(item => {
            let curationAdjustment = 0;
            
            // Face validates Person (+1 confidence boost)
            if (item.emoji === '🧑' && emojiMap['🙂']) {
                curationAdjustment += 1;
                if (!item.validation) item.validation = [];
                item.validation.push('face_confirmed');
            }
            
            // Pose validates Person (+1 confidence boost)  
            const hasPoseDetection = rankedConsensus.some(other => 
                other.evidence.specialized && other.evidence.specialized.includes('pose')
            );
            if (item.emoji === '🧑' && hasPoseDetection) {
                curationAdjustment += 1;
                if (!item.validation) item.validation = [];
                item.validation.push('pose_confirmed');
            }
            
            // NSFW requires human context (quality filter)
            if (item.emoji === '🔞') {
                if (emojiMap['🧑']) {
                    curationAdjustment += 1;
                    if (!item.validation) item.validation = [];
                    item.validation.push('human_context_confirmed');
                } else {
                    curationAdjustment -= 1;
                    if (!item.validation) item.validation = [];
                    item.validation.push('suspicious_no_humans');
                }
            }
            
            // Apply curation adjustment
            if (curationAdjustment !== 0) {
                item.evidence_weight += curationAdjustment;
                item.final_score += curationAdjustment;
                // Ensure we don't go negative
                item.evidence_weight = Math.max(0, item.evidence_weight);
                item.final_score = Math.max(0, item.final_score);
            }
        });
    }

    /**
     * Calculate evidence weight using consensus bonus system
     * "All services are equal, but some services are more equal than others"
     */
    calculateEvidenceWeight(analysis) {
        let weight = 0;
        
        // Base democratic weight: 1 vote per service (pure democracy)
        const baseVotes = analysis.total_votes;
        
        // Spatial consensus bonus: Agreement on location (prevents COCO bias)
        let spatialConsensusBonus = 0;
        if (analysis.evidence.spatial) {
            // Consensus = detection_count - 1 (one vote doesn't count as consensus)
            spatialConsensusBonus = Math.max(0, analysis.evidence.spatial.max_detection_count - 1);
        }
        
        // Content consensus bonus: Agreement across semantic + classification services
        // This levels the playing field for non-COCO concepts
        let contentConsensusBonus = 0;
        const semanticCount = analysis.evidence.semantic?.service_count || 0;
        const classificationCount = analysis.evidence.classification?.service_count || 0;
        const totalContentServices = semanticCount + classificationCount;
        
        if (totalContentServices >= 2) {
            // Consensus = total_content_services - 1 (one vote doesn't count as consensus)
            contentConsensusBonus = totalContentServices - 1;
        }
        
        // Total weight = democratic votes + consensus bonuses
        // Post-processing curation will handle validation adjustments
        weight = baseVotes + spatialConsensusBonus + contentConsensusBonus;
        
        return Math.max(0, weight); // Don't go negative
    }

    /**
     * Calculate final ranking with democratic voting + evidence weighting
     */
    calculateFinalRanking(emojiAnalysis) {
        // Calculate evidence weights
        emojiAnalysis.forEach(analysis => {
            analysis.evidence_weight = this.calculateEvidenceWeight(analysis);
            analysis.final_score = analysis.total_votes + analysis.evidence_weight;
            analysis.should_include = this.shouldIncludeInResults(analysis);
        });
        
        // Filter and sort
        return emojiAnalysis
            .filter(analysis => analysis.should_include)
            .sort((a, b) => {
                // Primary: Total votes (democratic)
                if (a.total_votes !== b.total_votes) {
                    return b.total_votes - a.total_votes;
                }
                // Secondary: Evidence weight
                return b.evidence_weight - a.evidence_weight;
            })
            .map(analysis => {
                const result = {
                    emoji: analysis.emoji,
                    votes: analysis.total_votes,
                    evidence_weight: Math.round(analysis.evidence_weight * 100) / 100,
                    final_score: Math.round(analysis.final_score * 100) / 100,
                    instances: analysis.instances,
                    evidence: {
                        spatial: analysis.evidence.spatial ? {
                            detection_count: analysis.evidence.spatial.max_detection_count,
                            avg_confidence: Math.round(analysis.evidence.spatial.avg_confidence * 1000) / 1000,
                            instance_count: analysis.evidence.spatial.total_instances
                        } : null,
                        semantic: analysis.evidence.semantic ? {
                            service_count: analysis.evidence.semantic.service_count,
                            words: analysis.evidence.semantic.words
                        } : null,
                        classification: analysis.evidence.classification ? {
                            service_count: analysis.evidence.classification.service_count
                        } : null,
                        specialized: analysis.evidence.specialized ? Object.keys(analysis.evidence.specialized) : null
                    },
                    services: analysis.voting_services
                };
                
                // Only include bounding_boxes if there are spatial detections
                const boundingBoxes = analysis.evidence.spatial?.clusters.map(cluster => ({
                    cluster_id: cluster.cluster_id,
                    merged_bbox: cluster.bbox,
                    emoji: analysis.emoji,
                    label: cluster.cluster_id?.split('_')[0] || analysis.emoji,
                    detection_count: cluster.detection_count,
                    avg_confidence: cluster.avg_confidence,
                    detections: cluster.individual_detections || []
                })) || [];
                
                if (boundingBoxes.length > 0) {
                    result.bounding_boxes = boundingBoxes;
                }
                
                // Only include validation/correlation if they exist and have content
                if (analysis.validation && analysis.validation.length > 0) {
                    result.validation = analysis.validation;
                }
                if (analysis.correlation && analysis.correlation.length > 0) {
                    result.correlation = analysis.correlation;
                }
                if (analysis.shiny) {
                    result.shiny = true;
                }
                
                return result;
            });
    }

    /**
     * Determine if emoji should be included in results
     */
    shouldIncludeInResults(analysis) {
        // Only include if has multiple votes (filter out single-vote emojis)
        return analysis.total_votes > 1;
    }

    /**
     * Extract special detections (non-competing)
     */
    extractSpecialDetections(serviceResults) {
        const special = {};
        
        // Text detection from OCR
        if (serviceResults.ocr?.predictions?.some(pred => pred.has_text)) {
            special.text = {
                emoji: "💬",
                detected: true,
                confidence: serviceResults.ocr.predictions[0].confidence || 1.0,
                content: serviceResults.ocr.predictions[0].text || null
            };
        } else {
            special.text = { detected: false };
        }
        
        // Face detection from Face service
        if (serviceResults.face?.success && serviceResults.face?.predictions?.some(pred => pred.emoji === '🙂')) {
            const facePrediction = serviceResults.face.predictions.find(pred => pred.emoji === '🙂');
            special.face = {
                emoji: "🙂",
                detected: true,
                confidence: facePrediction.confidence || 1.0,
                pose: facePrediction.pose || null
            };
        } else {
            special.face = { detected: false };
        }
        
        // NSFW detection from NSFW service
        if (serviceResults.nsfw?.success && serviceResults.nsfw?.predictions?.some(pred => pred.emoji === '🔞')) {
            const nsfwPrediction = serviceResults.nsfw.predictions.find(pred => pred.emoji === '🔞');
            special.nsfw = {
                emoji: "🔞",
                detected: true,
                confidence: nsfwPrediction.confidence || 1.0
            };
        } else {
            special.nsfw = { detected: false };
        }
        
        return special;
    }

    /**
     * OLD METHOD - Add a vote for an emoji from a service
     * TODO: Remove after transition complete
     */
    addEmojiVote_OLD(emojiVotes, emoji, serviceName, confidence) {
        if (!emojiVotes[emoji]) {
            emojiVotes[emoji] = [];
        }
        
        // OLD WEIGHT CALCULATION - REMOVED FOR V3
        // const weight = this.serviceWeights[serviceName] || 1.0;
        
        emojiVotes[emoji].push({
            service: serviceName,
            confidence: confidence,
            // weight: weight,  // REMOVED - No more arbitrary weights
            // weighted_score: confidence * weight  // REMOVED
        });
    }

    // COMMENTED OUT - OLD METHODS FOR REFERENCE
    // Will be removed after V3 transition is complete

    /*
    applySpecialModifiers_OLD(emojiVotes, serviceResults) {
        // Auto-promote NSFW emoji if detected
        if (serviceResults.nsfw?.predictions?.some(pred => pred.emoji === '🔞')) {
            if (!emojiVotes['🔞']) {
                emojiVotes['🔞'] = [];
            }
            // Ensure NSFW gets special treatment
            emojiVotes['🔞'].push({
                service: 'NSFW',
                confidence: 1.0,
                weight: 2.0,
                weighted_score: 2.0,
                special: true
            });
        }

        // Auto-promote text emoji if OCR detects text
        if (serviceResults.ocr?.predictions?.some(pred => pred.emoji === '💬' || pred.text)) {
            if (!emojiVotes['💬']) {
                emojiVotes['💬'] = [];
            }
            emojiVotes['💬'].push({
                service: 'OCR',
                confidence: 1.0,
                weight: 2.0,
                weighted_score: 2.0,
                special: true
            });
        }
    }

    calculateRankings_OLD(emojiVotes) {
        const results = {
            first_place: [],
            second_place: []
        };

        Object.entries(emojiVotes).forEach(([emoji, votes]) => {
            const voteCount = votes.length;
            
            const emojiResult = {
                emoji: emoji,
                votes: voteCount,
                services: votes.map(vote => ({
                    name: vote.service,
                    confidence: Math.round(vote.confidence * 1000) / 1000,
                    weight: vote.weight
                }))
            };

            // Special emojis always go to first place
            if (this.specialEmojis.includes(emoji)) {
                results.first_place.push(emojiResult);
            }
            // First place: 3+ votes
            else if (voteCount >= this.firstPlaceThreshold) {
                results.first_place.push(emojiResult);
            }
            // Second place: 2+ votes
            else if (voteCount >= this.minimumVotes) {
                results.second_place.push(emojiResult);
            }
            // Discard: 1 vote (not enough consensus)
        });

        // Sort by vote count, then by confidence
        const sortFn = (a, b) => {
            if (a.votes !== b.votes) return b.votes - a.votes;
            return b.confidence - a.confidence;
        };

        results.first_place.sort(sortFn);
        results.second_place.sort(sortFn);

        return results;
    }

    createRawTally_OLD(emojiVotes) {
        const tally = {};
        Object.entries(emojiVotes).forEach(([emoji, votes]) => {
            tally[emoji] = votes.length;
        });
        return tally;
    }
    */

}

module.exports = V3VotingService;