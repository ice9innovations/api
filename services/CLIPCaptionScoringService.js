const axios = require('axios');

/**
 * CLIP Caption Scoring Service
 * Specialized service for scoring caption similarity against images using CLIP
 */
class CLIPCaptionScoringService {
    constructor(config) {
        this.serviceURL = `http://${config.host}:${config.port}/v3/score`;
        this.healthURL = `http://${config.host}:${config.port}/health`;
        this.serviceName = 'CLIP-Scoring';
        this.timeout = config.timeout || 30000;
        this.retries = 0; // No retries for localhost ML services
    }

    /**
     * Score caption similarity against image
     * @param {string} imageInput - Image URL or file path
     * @param {string} caption - Caption text to score
     * @returns {Object} Similarity scoring result
     */
    async scoreCaption(imageInput, caption) {
        if (!caption || typeof caption !== 'string' || !caption.trim()) {
            throw new Error('Caption is required and must be a non-empty string');
        }

        const params = this.buildScoringParameters(imageInput, caption.trim());
        
        try {
            const response = await axios.get(this.serviceURL, {
                params: params,
                timeout: this.timeout
            });

            return this.processScoringResponse(response.data);
        } catch (error) {
            console.log(`❌ ${this.serviceName} error: ${error.message}`);
            
            // Provide clear error messages for different failure types
            if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
                throw new Error(`${this.serviceName} service offline: ${error.message}`);
            } else if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
                throw new Error(`${this.serviceName} service timeout: ${error.message}`);
            } else {
                throw new Error(`${this.serviceName} service failed: ${error.message}`);
            }
        }
    }

    /**
     * Build scoring parameters from image input and caption
     */
    buildScoringParameters(imageInput, caption) {
        const params = { caption: caption };
        
        if (imageInput.startsWith('http://') || imageInput.startsWith('https://')) {
            params.url = imageInput;
        } else {
            params.file = imageInput;
        }
        
        return params;
    }

    /**
     * Process scoring response
     */
    processScoringResponse(data) {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid response: not a JSON object');
        }

        if (data.status === 'error') {
            const errorMessage = data.error?.message || 'Unknown error';
            throw new Error(`CLIP scoring error: ${errorMessage}`);
        }

        if (data.status !== 'success') {
            throw new Error(`Invalid response status: ${data.status}`);
        }

        if (typeof data.similarity_score !== 'number') {
            throw new Error('Invalid response: missing similarity_score');
        }

        // Return structured scoring result
        return {
            success: true,
            service: 'clip-scoring',
            similarity_score: data.similarity_score,
            caption: data.caption,
            image_source: data.image_source,
            metadata: data.metadata || {},
            processing_time: data.metadata?.processing_time || 0
        };
    }

    /**
     * Health check
     */
    async checkHealth() {
        try {
            const response = await axios.get(this.healthURL, { 
                timeout: 5000 
            });
            return response.data;
        } catch (error) {
            throw new Error(`Health check failed: ${error.message}`);
        }
    }

}

module.exports = CLIPCaptionScoringService;