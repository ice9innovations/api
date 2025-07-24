/**
 * V2 Voting Service
 * Implements the Animal Farm emoji voting algorithm for v2 unified service responses
 * Much simpler than V1 due to standardized response format
 */

const stopword = require('stopword');

class V2VotingService {
    constructor() {
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
    }

    /**
     * Main entry point - processes all service results and returns voting results
     */
    processVotes(serviceResults) {
        // Step 1: Extract all emojis from unified v2 service results
        const dataModel = this.buildDataModel(serviceResults);
        
        // Step 2: Count emoji occurrences and apply single-value modifiers
        const predictionResult = this.updatePrediction(dataModel, serviceResults);
        const emojiVotes = predictionResult.emojiCounts;
        const modifiers = predictionResult.modifiers;
        
        // Step 3: Track which services voted for each emoji
        const voteTally = this.tallyVotes(dataModel, emojiVotes, modifiers);
        
        // Step 4: Apply ranking algorithm with promotion rules
        const finalResults = this.finalVoteTally(voteTally);
        
        return {
            emoji_predictions: finalResults,
            service_votes: dataModel,
            raw_tally: voteTally
        };
    }

    /**
     * Extract emojis from all v2 service results
     * Much simpler than v1 due to unified prediction format
     */
    buildDataModel(serviceResults) {
        const dataModel = {};

        Object.entries(serviceResults).forEach(([serviceName, result]) => {
            if (!result.success || !result.data || !result.data.predictions) {
                return;
            }

            const serviceEmojis = [];
            
            result.data.predictions.forEach(prediction => {
                // Handle different prediction types
                if (prediction.type === 'emoji_mappings' && prediction.properties?.mappings) {
                    // Extract emojis from emoji_mappings (BLIP, Ollama)
                    prediction.properties.mappings.forEach(mapping => {
                        if (mapping.emoji) {
                            serviceEmojis.push({
                                emoji: mapping.emoji,
                                type: 'emoji_mapping',
                                word: mapping.word,
                                confidence: 1.0
                            });
                        }
                    });
                } else if (prediction.emoji && prediction.type !== 'color_analysis') {
                    // Extract emoji from other prediction types (object_detection, classification, etc)
                    // Skip color_analysis predictions - they shouldn't participate in emoji voting
                    const emojiEntry = {
                        emoji: prediction.emoji,
                        type: prediction.type,
                        confidence: prediction.confidence || 1.0
                    };

                    // Add type-specific information
                    if (prediction.label) {
                        emojiEntry.label = prediction.label;
                    }
                    if (prediction.text) {
                        emojiEntry.text = prediction.text;
                    }
                    if (prediction.value) {
                        emojiEntry.value = prediction.value;
                    }

                    serviceEmojis.push(emojiEntry);
                }
            });

            if (serviceEmojis.length > 0) {
                // Deduplicate emojis within each service (only count each emoji once per service)
                const uniqueEmojis = [];
                const seenEmojis = new Set();
                
                serviceEmojis.forEach(emojiEntry => {
                    if (!seenEmojis.has(emojiEntry.emoji)) {
                        seenEmojis.add(emojiEntry.emoji);
                        uniqueEmojis.push(emojiEntry);
                    }
                });
                
                dataModel[serviceName] = uniqueEmojis;
            }
        });

        return dataModel;
    }

    /**
     * Count emoji votes and apply single-value modifiers
     * Prioritizes sentence-level processing over word-level when both exist
     */
    updatePrediction(dataModel, serviceResults) {
        const emojiCounts = {};

        // Count emojis from all services, prioritizing sentence-level processing
        Object.entries(dataModel).forEach(([serviceName, serviceData]) => {
            // Check if this service has sentence-level emoji_mappings
            const hasSentenceMappings = serviceData.some(item => item.type === 'emoji_mapping');
            
            serviceData.forEach(item => {
                if (item.emoji && item.type !== 'color_analysis') {
                    // Only count this emoji if:
                    // 1. It's a sentence-level mapping (emoji_mapping type), OR
                    // 2. This service has no sentence-level mappings at all
                    // Skip color_analysis predictions - they shouldn't participate in emoji voting
                    const shouldCount = item.type === 'emoji_mapping' || !hasSentenceMappings;
                    
                    if (shouldCount) {
                        emojiCounts[item.emoji] = (emojiCounts[item.emoji] || 0) + 1;
                    }
                    // Skip word-level predictions when sentence-level exist for this service
                }
            });
        });

        // Apply single-value modifiers based on v2 prediction types
        // Store modifiers separately to track service attribution
        const modifiers = {};
        
        Object.entries(serviceResults).forEach(([serviceName, result]) => {
            if (!result.success || !result.data || !result.data.predictions) {
                return;
            }

            result.data.predictions.forEach(prediction => {
                // NSFW content moderation modifier
                if (prediction.type === 'content_moderation' && 
                    prediction.label === 'nsfw' && 
                    prediction.confidence > 0.5) {
                    emojiCounts['🔞'] = (emojiCounts['🔞'] || 0) + 1;
                    if (!modifiers['🔞']) modifiers['🔞'] = [];
                    modifiers['🔞'].push(this.serviceNames[serviceName] || serviceName);
                }

                // Text extraction modifier
                if (prediction.type === 'text_extraction' && 
                    prediction.properties?.has_text) {
                    emojiCounts['💬'] = (emojiCounts['💬'] || 0) + 1;
                    if (!modifiers['💬']) modifiers['💬'] = [];
                    modifiers['💬'].push(this.serviceNames[serviceName] || serviceName);
                }
            });
        });

        return { emojiCounts, modifiers };
    }

    /**
     * Track which services voted for each emoji
     * Same logic as v1 but with cleaner data extraction
     */
    tallyVotes(dataModel, emojiCounts, modifiers = {}) {
        const voteTally = {};

        // Initialize tally for each emoji
        Object.keys(emojiCounts).forEach(emoji => {
            voteTally[emoji] = {
                count: emojiCounts[emoji],
                services: []
            };
        });

        // Track which services voted for each emoji from predictions
        // Apply same prioritization logic as vote counting
        Object.entries(dataModel).forEach(([serviceName, serviceData]) => {
            // Check if this service has sentence-level emoji_mappings
            const hasSentenceMappings = serviceData.some(item => item.type === 'emoji_mapping');
            
            serviceData.forEach(item => {
                if (item.emoji && voteTally[item.emoji] && item.type !== 'color_analysis') {
                    // Only attribute this emoji if it would have been counted in voting
                    // Skip color_analysis predictions - they shouldn't participate in emoji voting
                    if (item.type === 'emoji_mapping' || !hasSentenceMappings) {
                        const displayName = this.serviceNames[serviceName] || serviceName;
                        if (!voteTally[item.emoji].services.includes(displayName)) {
                            voteTally[item.emoji].services.push(displayName);
                        }
                    }
                }
            });
        });

        // Add services from single-value modifiers
        Object.entries(modifiers).forEach(([emoji, services]) => {
            if (voteTally[emoji]) {
                services.forEach(service => {
                    if (!voteTally[emoji].services.includes(service)) {
                        voteTally[emoji].services.push(service);
                    }
                });
            }
        });

        return voteTally;
    }

    /**
     * Apply ranking algorithm with promotion rules
     * Same algorithm as v1 - no changes needed
     */
    finalVoteTally(voteTally) {
        // Convert to array and sort by count
        const sortedEmojis = Object.entries(voteTally)
            .map(([emoji, data]) => ({
                emoji: emoji,
                votes: data.count,
                services: data.services,
                bots: data.services.join(',')  // Add bots field matching original format
            }))
            .sort((a, b) => b.votes - a.votes);

        const firstPlace = [];
        const secondPlace = [];
        
        // Special handling for NSFW and OCR - they always go to first place
        const specialEmojis = ['🔞', '💬'];
        const specialItems = [];
        const regularItems = [];
        
        sortedEmojis.forEach(item => {
            if (specialEmojis.includes(item.emoji) && item.votes > 0) {
                specialItems.push(item);
            } else {
                regularItems.push(item);
            }
        });
        
        // Add special emojis to first place (NSFW first, then OCR)
        specialItems.forEach(item => {
            firstPlace.push(item);
        });

        // Process regular emojis with normal voting rules
        regularItems.forEach((item, index) => {
            const uniqueServices = item.services.length;
            
            // Promotion rules exactly matching original finalVoteTally function
            if (firstPlace.length === 0 && index === 0) {
                // First guess is always promoted (only if no special emojis)
                firstPlace.push(item);
            } else if (index < 2 && item.votes >= 2 && uniqueServices >= 2) {
                // Two votes from two different bots can override (line 1165-1167)
                firstPlace.push(item);
            } else if (index < 3 && item.votes >= 2 && uniqueServices >= 2) {
                // Three votes from three bots can override (line 1169-1171)
                // NOTE: Original has same condition as above - this is intentional!
                firstPlace.push(item);
            } else if (index >= 3 && item.votes >= 3 && uniqueServices >= 3) {
                // Beyond position 3: need 3+ votes from 3+ services (line 1173-1174)
                firstPlace.push(item);
            } else {
                // Everything else is second place (line 1176)
                secondPlace.push(item);
            }
        });

        return {
            votes: Object.fromEntries(
                sortedEmojis.map(item => [item.emoji, item.votes])
            ),
            first_place: firstPlace,
            second_place: secondPlace,
            service_attribution: voteTally
        };
    }

    /**
     * Score captions based on emoji matches
     * Returns scored captions with word-emoji matches highlighted
     */
    scoreCaptions(captions, votingResults, serviceResults) {
        const scores = {};
        
        if (captions.blip) {
            scores.blip = this.scoreCaption(captions.blip, 'BLIP', votingResults, serviceResults);
        }
        
        if (captions.llama) {
            scores.llama = this.scoreCaption(captions.llama, 'LLaMa', votingResults, serviceResults);
        }
        
        return scores;
    }

    /**
     * Score a single caption based on word-to-emoji matches
     */
    scoreCaption(caption, source, votingResults, serviceResults) {
        if (!caption) return null;
        
        // Get word-to-emoji mappings from the service that generated this caption
        const serviceName = source.toLowerCase();
        const serviceData = serviceResults[serviceName === 'llama' ? 'ollama' : serviceName];
        
        if (!serviceData?.data?.predictions) {
            return {
                original: caption,
                score: 0,
                matches: 0,
                words: caption.split(' ').length,
                formatted: caption
            };
        }
        
        // Find emoji_mappings predictions from this service
        const emojiMappings = [];
        serviceData.data.predictions.forEach(pred => {
            if (pred.type === 'emoji_mappings' && pred.properties?.mappings) {
                pred.properties.mappings.forEach(mapping => {
                    if (mapping.word && mapping.emoji) {
                        emojiMappings.push({
                            word: mapping.word.toLowerCase(),
                            emoji: mapping.emoji
                        });
                    }
                });
            }
        });
        
        // Score based on matches with voting results
        let score = 0;
        let matches = 0;
        let formattedCaption = caption;
        const firstPlaceEmojis = votingResults.emoji_predictions.first_place || [];
        const secondPlaceEmojis = votingResults.emoji_predictions.second_place || [];
        
        // Create sets for quick lookup
        const firstPlaceSet = new Set(firstPlaceEmojis.map(item => item.emoji));
        const secondPlaceSet = new Set(secondPlaceEmojis.map(item => item.emoji));
        
        // Process each word-emoji mapping
        emojiMappings.forEach(mapping => {
            const { word, emoji } = mapping;
            
            // Convert token format (teddy_bear) to natural text format (teddy bear) for matching
            const displayWord = word.replace(/_/g, ' ');
            
            if (firstPlaceSet.has(emoji)) {
                // First place match: +1 score
                score += 1;
                matches += 1;
                // Replace word with underlined version + emoji
                const regex = new RegExp(`\\b${displayWord}\\b`, 'gi');
                formattedCaption = formattedCaption.replace(regex, `<u title="${emoji}">${displayWord}</u> ${emoji}`);
            } else if (secondPlaceSet.has(emoji)) {
                // Second place match: -1 score
                score -= 1;
                matches += 1;
                // Replace word with italic version + emoji
                const regex = new RegExp(`\\b${displayWord}\\b`, 'gi');
                formattedCaption = formattedCaption.replace(regex, `<i title="${emoji}">${displayWord}</i> ${emoji}`);
            } else {
                // Failed to qualify emoji match: -1 penalty for backing a rejected emoji
                score -= 1;
                matches += 1;
                // Replace word with strikethrough version + emoji
                const regex = new RegExp(`\\b${displayWord}\\b`, 'gi');
                formattedCaption = formattedCaption.replace(regex, `<s title="${emoji}">${displayWord}</s> ${emoji}`);
            }
        });
        
        // Count meaningful words (excluding stopwords) for ratio calculation
        const allWords = caption.split(' ');
        const meaningfulWords = stopword.removeStopwords(allWords).length;
        
        // Calculate score as ratio: points / meaningful_words (shorter captions win ties)
        const finalScore = meaningfulWords > 0 ? score / meaningfulWords : 0;
        
        return {
            original: caption,
            raw_score: score,
            score: Math.round(finalScore * 100) / 100, // Round to 2 decimals
            matches: matches,
            words: meaningfulWords,
            total_words: allWords.length,
            formatted: formattedCaption,
            percentage: meaningfulWords > 0 ? Math.round((matches / meaningfulWords) * 100) : 0
        };
    }
}

module.exports = V2VotingService;