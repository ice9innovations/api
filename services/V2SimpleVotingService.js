/**
 * V2 Simple Voting Service
 * Clean, straightforward voting algorithm designed for the new "one vote per service per emoji" system
 */

// Load V2VotingService once at module level to avoid repeated require() calls
const V2VotingService = require('./V2VotingService');

class V2SimpleVotingService {
    constructor(options = {}) {
        this.serviceNames = {
            blip: 'BLIP',
            clip: 'CLIP', 
            yolo: 'YOLO',
            colors: 'Colors',
            detectron2: 'Detectron2',
            face: 'Face',
            nsfw: 'NSFW',
            ocr: 'OCR',
            inception: 'Inception',
            rtdetr: 'RT-DETR',
            metadata: 'Metadata',
            ollama: 'LLaMa'
        };
        
        // Special emojis that auto-promote to first place
        this.specialEmojis = ['🔞', '💬'];
        
        // Configurable voting thresholds
        this.firstPlaceThreshold = options.firstPlaceThreshold || 3;  // 3+ votes = first place
        this.minimumVotes = options.minimumVotes || 2;                // 2+ votes = second place, 1 vote = discard
        this.defaultConfidence = options.defaultConfidence || 0.75;   // Default confidence for services without scores
        
        // Service weighting (default 1.0 for all services, COCO specialists boosted)
        this.serviceWeights = {
            'BLIP': 1.0,
            'CLIP': 1.0,
            'YOLO': 1.25,       // COCO specialist boost
            'Detectron2': 1.25, // COCO specialist boost
            'Face': 1.0,
            'NSFW': 1.0,
            'OCR': 1.0,
            'Inception': 1.0,
            'RT-DETR': 1.25,    // COCO specialist boost
            'Metadata': 1.0,
            'LLaMa': 1.0,
            ...options.serviceWeights  // Allow overrides
        };
    }

    /**
     * Main entry point - processes all service results and returns voting results
     */
    processVotes(serviceResults) {
        // Step 1: Extract all emojis with their confidence scores
        const emojiVotes = this.extractEmojiVotes(serviceResults);
        
        // Step 2: Apply special emoji modifiers (NSFW, OCR)
        this.applySpecialModifiers(emojiVotes, serviceResults);
        
        // Step 3: Sort and categorize emojis
        const finalResults = this.categorizeEmojis(emojiVotes);
        
        // Step 4: Build compatibility data structures
        const dataModel = this.buildDataModel(serviceResults);
        const voteTally = this.buildVoteTally(emojiVotes);
        
        return {
            emoji_predictions: finalResults,
            service_votes: dataModel,
            raw_tally: voteTally
        };
    }

    /**
     * Extract emoji votes with confidence scores from all services
     */
    extractEmojiVotes(serviceResults) {
        const emojiVotes = {};

        Object.entries(serviceResults).forEach(([serviceName, result]) => {
            if (!result.success || !result.data || !result.data.predictions) {
                return;
            }

            const serviceDisplayName = this.serviceNames[serviceName] || serviceName;
            const seenEmojis = new Set(); // Deduplicate within service

            result.data.predictions.forEach(prediction => {
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
     * Add a vote for an emoji with confidence tracking and service weighting
     */
    addEmojiVote(emojiVotes, emoji, serviceName, confidence) {
        if (!emojiVotes[emoji]) {
            emojiVotes[emoji] = {
                votes: 0,
                weightedVotes: 0,
                services: [],
                avgConfidence: 0
            };
        }

        const serviceWeight = this.serviceWeights[serviceName] || 1.0;
        
        emojiVotes[emoji].votes++;
        emojiVotes[emoji].weightedVotes += serviceWeight;
        emojiVotes[emoji].services.push({
            name: serviceName,
            confidence: confidence
        });
        
        // Update average confidence
        emojiVotes[emoji].avgConfidence = 
            emojiVotes[emoji].services.reduce((sum, service) => sum + service.confidence, 0) / 
            emojiVotes[emoji].services.length;
    }

    /**
     * Apply special emoji modifiers (NSFW, OCR)
     */
    applySpecialModifiers(emojiVotes, serviceResults) {
        Object.entries(serviceResults).forEach(([serviceName, result]) => {
            if (!result.success || !result.data || !result.data.predictions) {
                return;
            }

            const serviceDisplayName = this.serviceNames[serviceName] || serviceName;

            result.data.predictions.forEach(prediction => {
                // NSFW content moderation modifier
                if (prediction.type === 'content_moderation' && 
                    prediction.label === 'nsfw' && 
                    prediction.confidence > 0.5) {
                    this.addEmojiVote(emojiVotes, '🔞', serviceDisplayName, prediction.confidence);
                }

                // Text extraction modifier
                if (prediction.type === 'text_extraction' && 
                    prediction.properties?.has_text) {
                    this.addEmojiVote(emojiVotes, '💬', serviceDisplayName, prediction.confidence || 1.0);
                }
            });
        });
    }

    /**
     * Sort and categorize emojis into first place, second place, or discard
     */
    categorizeEmojis(emojiVotes) {
        // Adaptive thresholds based on scene complexity
        const totalEmojis = Object.keys(emojiVotes).length;
        const adaptiveFirstPlace = totalEmojis > 15 ? 2 : this.firstPlaceThreshold;
        // Always require at least 2 votes - collaborative voting principle
        const adaptiveMinimum = Math.max(2, totalEmojis > 15 ? 2 : this.minimumVotes);
        
        // Convert to array for sorting
        const sortedEmojis = Object.entries(emojiVotes)
            .map(([emoji, data]) => ({
                emoji: emoji,
                votes: data.votes,
                weightedVotes: data.weightedVotes,
                services: data.services,
                avgConfidence: data.avgConfidence,  // Keep for internal tiebreaking logic
                bots: data.services.join(',')  // For compatibility
            }))
            .filter(item => item.weightedVotes >= adaptiveMinimum) // Discard based on adaptive threshold
            .sort((a, b) => {
                // Primary sort: weighted vote count (descending)
                if (a.weightedVotes !== b.weightedVotes) {
                    return b.weightedVotes - a.weightedVotes;
                }
                // Secondary sort: confidence (descending)
                return b.avgConfidence - a.avgConfidence;
            });

        const firstPlace = [];
        const secondPlace = [];

        sortedEmojis.forEach(item => {
            // Clean up item for API consumers - remove internal algorithm fields
            const cleanItem = {
                emoji: item.emoji,
                votes: item.votes,
                services: item.services
                // Removed: avgConfidence (internal tiebreaking), weightedVotes (internal algorithm), bots (legacy)
            };

            if (this.specialEmojis.includes(item.emoji) && item.weightedVotes > 0) {
                // Special emojis auto-promote to first place
                firstPlace.push(cleanItem);
            } else if (item.weightedVotes >= adaptiveFirstPlace) {
                // High weighted vote count = first place (adaptive threshold)
                firstPlace.push(cleanItem);
            } else if (item.weightedVotes >= adaptiveMinimum) {
                // Medium weighted vote count = second place (adaptive threshold)
                secondPlace.push(cleanItem);
            }
            // Low weighted votes are already filtered out
        });

        
        return {
            first_place: firstPlace,
            second_place: secondPlace
        };
    }

    /**
     * Build data model for compatibility with existing code
     */
    buildDataModel(serviceResults) {
        const dataModel = {};

        Object.entries(serviceResults).forEach(([serviceName, result]) => {
            if (!result.success || !result.data || !result.data.predictions) {
                return;
            }

            const serviceEmojis = [];
            const seenEmojis = new Set();
            
            result.data.predictions.forEach(prediction => {
                if (prediction.type === 'emoji_mappings' && prediction.properties?.mappings) {
                    prediction.properties.mappings.forEach(mapping => {
                        if (mapping.emoji && !seenEmojis.has(mapping.emoji)) {
                            seenEmojis.add(mapping.emoji);
                            serviceEmojis.push({
                                emoji: mapping.emoji,
                                type: 'emoji_mapping',
                                word: mapping.word,
                                confidence: 1.0
                            });
                        }
                    });
                } else if (prediction.emoji && prediction.type !== 'color_analysis') {
                    if (!seenEmojis.has(prediction.emoji)) {
                        seenEmojis.add(prediction.emoji);
                        serviceEmojis.push({
                            emoji: prediction.emoji,
                            type: prediction.type,
                            confidence: prediction.confidence || 1.0,
                            label: prediction.label,
                            text: prediction.text,
                            value: prediction.value
                        });
                    }
                }
            });

            if (serviceEmojis.length > 0) {
                dataModel[serviceName] = serviceEmojis;
            }
        });

        return dataModel;
    }

    /**
     * Build vote tally for compatibility
     */
    buildVoteTally(emojiVotes) {
        const voteTally = {};
        
        Object.entries(emojiVotes).forEach(([emoji, data]) => {
            voteTally[emoji] = {
                count: data.votes,
                services: data.services
            };
        });

        return voteTally;
    }

    /**
     * Score captions - reuse logic from V2VotingService
     */
    scoreCaptions(captions, votingResults, serviceResults) {
        // Use pre-loaded V2VotingService to avoid repeated require() calls
        // Create instance once per call (still needed for stateful operations)
        const originalService = new V2VotingService();
        return originalService.scoreCaptions(captions, votingResults, serviceResults);
    }
}

module.exports = V2SimpleVotingService;