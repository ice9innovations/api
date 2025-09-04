const stopword = require('stopword');

/**
 * Caption Aggregation Service - handles V3 caption collection and scoring
 * Follows the unified caption aggregation requirements from Issue 15
 */
class CaptionAggregationService {
    constructor() {
        // Service name mappings for caption attribution
        this.serviceNames = {
            blip: 'BLIP',
            ollama: 'LLaMa'
        };
        
        // Import CLIP scoring service for similarity scoring
        const { clipScoring } = require('./index');
        this.clipScoringService = clipScoring;
    }

    /**
     * Main entry point - aggregates and scores captions from V3 service responses
     * @param {Object} serviceResults - Raw V3 service responses
     * @param {Object} votingResults - Emoji voting results for scoring
     * @param {string} imagePath - Path to image for CLIP similarity scoring (optional)
     * @returns {Object} Unified captions section with scoring
     */
    async aggregateCaptions(serviceResults, votingResults, imagePath = null) {
        const rawCaptions = this.extractCaptions(serviceResults);
        const captionScores = await this.scoreCaptions(rawCaptions, votingResults, serviceResults, imagePath);
        
        return this.buildCaptionsResponse(rawCaptions, captionScores, serviceResults);
    }

    /**
     * Extract caption text from V3 service responses
     * @param {Object} serviceResults - Raw V3 service responses 
     * @returns {Object} Raw caption text by service
     */
    extractCaptions(serviceResults) {
        const captions = {};
        
        // BLIP V3 format: predictions[0].text with emoji_mappings
        if (serviceResults.blip?.predictions && serviceResults.blip.predictions.length > 0) {
            const prediction = serviceResults.blip.predictions[0];
            if (prediction?.text) {
                captions.blip = prediction.text;
            }
        }
        
        // Ollama V3 format: predictions[0].text with emoji_mappings  
        if (serviceResults.ollama?.predictions && serviceResults.ollama.predictions.length > 0) {
            const prediction = serviceResults.ollama.predictions[0];
            if (prediction?.text) {
                captions.llama = prediction.text;
            }
        }
        
        return captions;
    }

    /**
     * Score captions based on emoji matches with voting results and CLIP similarity
     * @param {Object} captions - Raw caption text by service
     * @param {Object} votingResults - Emoji voting results
     * @param {Object} serviceResults - Raw V3 service responses for emoji_mappings
     * @param {string} imagePath - Path to image for CLIP similarity scoring (optional)
     * @returns {Object} Caption scores by service
     */
    async scoreCaptions(captions, votingResults, serviceResults, imagePath = null) {
        const scores = {};
        
        if (captions.blip) {
            scores.blip = await this.scoreCaption(captions.blip, 'BLIP', votingResults, serviceResults, imagePath);
        }
        
        if (captions.llama) {
            scores.llama = await this.scoreCaption(captions.llama, 'LLaMa', votingResults, serviceResults, imagePath);
        }
        
        return scores;
    }

    /**
     * Score a single caption using CLIP similarity
     * Primary scoring: CLIP similarity (0.0-1.0)
     * Tie-breaking: Meaningful word count (fewer words preferred)
     * OLD algorithm (commented out): word-to-emoji matching with +1/-1 scoring
     */
    async scoreCaption(caption, source, votingResults, serviceResults, imagePath = null) {
        if (!caption) return null;
        
        // Get word-to-emoji mappings from V3 service response
        const serviceName = source.toLowerCase();
        const serviceKey = serviceName === 'llama' ? 'ollama' : serviceName;
        const serviceData = serviceResults[serviceKey];
        
        if (!serviceData?.predictions) {
            return {
                original: caption,
                // OLD SCORING FIELDS - COMMENTED OUT
                // score: 0,
                // matches: 0,
                // formatted: caption
                words: stopword.removeStopwords(caption.split(' ')).length, // Keep meaningful word count
                clip_similarity: null // No CLIP score available
            };
        }
        
        // Find emoji_mappings from V3 predictions
        const emojiMappings = [];
        serviceData.predictions.forEach(pred => {
            if (pred.emoji_mappings && Array.isArray(pred.emoji_mappings)) {
                pred.emoji_mappings.forEach(mapping => {
                    if (mapping.word && mapping.emoji) {
                        emojiMappings.push({
                            word: mapping.word.toLowerCase(),
                            emoji: mapping.emoji
                        });
                    }
                });
            }
        });
        
        // OLD CAPTION SCORING MECHANISM - COMMENTED OUT IN FAVOR OF CLIP SIMILARITY
        // Score based on matches with voting results  
        // let matchesArray = [];     // First place matches (unique)
        // let penaltiesArray = [];   // Rejected emoji penalties (unique)
        // let matchesSet = new Set(); // Track unique matches
        // let penaltiesSet = new Set(); // Track unique penalties
        // let formattedCaption = caption;
        // const firstPlaceEmojis = votingResults.votes.consensus || [];
        // const secondPlaceEmojis = votingResults.votes.second_place || [];
        
        // Create sets for quick lookup
        // const firstPlaceSet = new Set(firstPlaceEmojis.map(item => item.emoji));
        // const secondPlaceSet = new Set(secondPlaceEmojis.map(item => item.emoji));
        
        // Process each word-emoji mapping
        // emojiMappings.forEach(mapping => {
        //     const { word, emoji } = mapping;
        //     
        //     // Convert token format (teddy_bear) to natural text format (teddy bear) for matching
        //     const displayWord = word.replace(/_/g, ' ');
        //     
        //     if (firstPlaceSet.has(emoji)) {
        //         // First place match: +1 point (unique only)
        //         const uniqueKey = `${word}:${emoji}`;
        //         if (!matchesSet.has(uniqueKey)) {
        //             matchesSet.add(uniqueKey);
        //             matchesArray.push({ word, emoji });
        //         }
        //     } else if (secondPlaceSet.has(emoji)) {
        //         // Second place match: neutral (no penalty, no reward)
        //         // No scoring impact
        //     } else {
        //         // Rejected emoji: -1 penalty (unique only)
        //         const uniqueKey = `${word}:${emoji}`;
        //         if (!penaltiesSet.has(uniqueKey)) {
        //             penaltiesSet.add(uniqueKey);
        //             penaltiesArray.push({ word, emoji });
        //         }
        //     }
        // });
        
        // Count meaningful words (excluding stopwords) for tie-breaking
        const allWords = caption.split(' ');
        const meaningfulWords = stopword.removeStopwords(allWords).length;
        
        // OLD SCORE CALCULATION - COMMENTED OUT
        // Calculate score as matches - penalties (word-matching algorithm)
        // const finalScore = matchesArray.length - penaltiesArray.length;
        
        // Compute CLIP similarity score if image path is available
        let clipScore = null;
        
        if (imagePath && this.clipScoringService) {
            try {
                console.log(`📊 Computing CLIP similarity for ${source} caption: "${caption}"`);
                const clipResult = await this.clipScoringService.scoreCaption(imagePath, caption);
                clipScore = clipResult.similarity_score;
                console.log(`✅ CLIP similarity for ${source}: ${clipScore}`);
            } catch (error) {
                console.warn(`⚠️ CLIP scoring failed for ${source}: ${error.message}`);
                // clipScore remains null - that's all we need to know
            }
        }
        
        return {
            original: caption,
            // OLD SCORING FIELDS - COMMENTED OUT IN FAVOR OF CLIP SIMILARITY
            // score: finalScore,
            // matches: matchesArray,
            // penalties: penaltiesArray,
            // match_rate: meaningfulWords > 0 ? Math.round((matchesArray.length / meaningfulWords) * 1000) / 1000 : 0,
            words: meaningfulWords, // Keep for tie-breaking when CLIP scores are equal
            clip_similarity: clipScore
        };
    }

    /**
     * Build unified captions response structure - equal treatment for both services
     * @param {Object} rawCaptions - Raw caption text by service
     * @param {Object} captionScores - Scored captions by service  
     * @param {Object} serviceResults - Raw V3 service responses for emoji_mappings
     * @returns {Object} Unified captions section with both services on equal footing
     */
    buildCaptionsResponse(rawCaptions, captionScores, serviceResults) {
        const captions = {};
        
        // Build BLIP caption if available
        if (captionScores.blip) {
            const serviceData = serviceResults.blip;
            const emojiMappings = [];
            
            // Extract emoji_mappings from service response
            if (serviceData?.predictions) {
                serviceData.predictions.forEach(pred => {
                    if (pred.emoji_mappings && Array.isArray(pred.emoji_mappings)) {
                        pred.emoji_mappings.forEach(mapping => {
                            if (mapping.word && mapping.emoji) {
                                emojiMappings.push({
                                    emoji: mapping.emoji,
                                    word: mapping.word
                                });
                            }
                        });
                    }
                });
            }
            
            captions.blip = {
                ...captionScores.blip,
                emoji_mappings: emojiMappings
            };
        }
        
        // Build LLaMa caption if available
        if (captionScores.llama) {
            const serviceData = serviceResults.ollama;
            const emojiMappings = [];
            
            // Extract emoji_mappings from service response
            if (serviceData?.predictions) {
                serviceData.predictions.forEach(pred => {
                    if (pred.emoji_mappings && Array.isArray(pred.emoji_mappings)) {
                        pred.emoji_mappings.forEach(mapping => {
                            if (mapping.word && mapping.emoji) {
                                emojiMappings.push({
                                    emoji: mapping.emoji,
                                    word: mapping.word
                                });
                            }
                        });
                    }
                });
            }
            
            captions.llama = {
                ...captionScores.llama,
                emoji_mappings: emojiMappings
            };
        }
        
        return { captions };
    }
}

module.exports = CaptionAggregationService;