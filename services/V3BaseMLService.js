const axios = require('axios');

/**
 * Base service class for V3 ML services
 * Handles native v3 response formats without conversion
 */
class V3BaseMLService {
    constructor(config) {
        this.serviceURL = `http://${config.host}:${config.port}/v3/analyze`;
        this.healthURL = `http://${config.host}:${config.port}/health`;
        this.serviceName = config.name;
        this.timeout = config.timeout || 30000;
        this.retries = 0; // No retries for localhost ML services
    }

    /**
     * Main analyze method - handles both URL and file inputs
     */
    async analyze(imageInput) {
        const params = this.buildV3Parameters(imageInput);
        
        try {
            const response = await axios.get(this.serviceURL, {
                params: params,
                timeout: this.timeout
            });

            return this.processV3Response(response.data);
        } catch (error) {
            console.log(`❌ ${this.serviceName} (v3) error: ${error.message}`);
            
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
     * Build v3 parameters from image input
     */
    buildV3Parameters(imageInput) {
        if (imageInput.startsWith('http://') || imageInput.startsWith('https://')) {
            return { url: imageInput };
        } else {
            return { file: imageInput };
        }
    }

    /**
     * Process v3 response - pass through natively without conversion
     */
    processV3Response(data) {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid response: not a JSON object');
        }

        if (data.status === 'error') {
            const errorMessage = data.error?.message || 'Unknown error';
            throw new Error(`Service error: ${errorMessage}`);
        }

        if (data.status !== 'success') {
            throw new Error(`Invalid response status: ${data.status}`);
        }

        // Return v3 response natively - no conversion needed
        return {
            success: true,
            service: data.service || this.serviceName,
            status: data.status,
            predictions: data.predictions || [],
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

module.exports = V3BaseMLService;