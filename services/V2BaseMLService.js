/**
 * V2 Base class for ML service clients using unified response format
 * Provides common functionality for v2 endpoints with POST requests
 */
class V2BaseMLService {
    constructor(config) {
        this.serviceURL = `http://${config.host}:${config.port}${config.endpoint}`;
        this.serviceName = config.name;
        this.timeout = parseInt(process.env.ML_TIMEOUT);
        this.maxRetries = parseInt(process.env.ML_MAX_RETRIES);
        
        // Get optimal image size from service configuration
        this.optimalDimension = config.optimalSize || 'original';
    }

    async analyze(imageUrl) {
        return this.processImage(imageUrl, 0);
    }

    async analyzeFile(filePath) {
        return this.processImageFile(filePath, 0);
    }
    
    /**
     * Resolve optimal variant path for this service
     * @param {string} filePath - Original file path
     * @returns {string} Path to optimal variant or original if not found
     */
    resolveOptimalVariant(filePath) {
        // If service uses original, return as-is
        if (this.optimalDimension === 'original') {
            return filePath;
        }
        
        // Try to find service-specific optimized variant
        const path = require('path');
        const fs = require('fs');
        
        // Parse original path
        const parsedPath = path.parse(filePath);
        const filename = parsedPath.name + '.jpg'; // Variants are always .jpg
        
        // Look for variants in common directory structures
        const possibleVariantPaths = [
            // Structure: /data/originals/image.jpg -> /data/variants/384/image.jpg
            path.join(path.dirname(parsedPath.dir), 'variants', this.optimalDimension, filename),
            // Structure: /coco/images/image.jpg -> /coco/variants/384/image.jpg  
            path.join(parsedPath.dir, '..', 'variants', this.optimalDimension, filename),
            // Structure: /dataset/384/image.jpg (already in variant directory)
            path.join(parsedPath.dir, '..', this.optimalDimension, filename)
        ];
        
        for (const variantPath of possibleVariantPaths) {
            if (fs.existsSync(variantPath)) {
                console.log(`📐 ${this.serviceName}: Using optimized ${this.optimalDimension}px variant`);
                return variantPath;
            }
        }
        
        // Fallback to original with performance warning
        console.log(`🚨 ${this.serviceName}: ${this.optimalDimension}px variant not found, using original (SLOW!)`);
        return filePath;
    }

    async processImage(imageUrl, retryCount) {
        try {
            console.log(`🔍 ${this.serviceName} (v2) analyzing via: ${this.serviceURL} (attempt ${retryCount + 1}/${this.maxRetries + 1})`);

            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Request timeout')), this.timeout);
            });

            const axios = require('axios');
            const fetchPromise = axios.get(this.serviceURL, {
                params: {
                    image_url: imageUrl
                },
                headers: {
                    'Accept': 'application/json'
                },
                timeout: this.timeout
            });

            const response = await Promise.race([fetchPromise, timeoutPromise]);
            console.log(`✅ ${this.serviceName} (v2) received response, status: ${response.status}`);
            const result = this.processV2Response(response);
            console.log(`🎯 ${this.serviceName} (v2) response processed successfully`);
            return result;

        } catch (error) {
            console.error(`❌ ${this.serviceName} (v2) error on attempt ${retryCount + 1}:`, error.message);

            if (retryCount < this.maxRetries) {
                console.log(`${this.serviceName} (v2) retrying... (${retryCount + 1}/${this.maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                return this.processImage(imageUrl, retryCount + 1);
            } else {
                throw new Error(`${this.serviceName} service failed after ${this.maxRetries} retries: ${error.message}`);
            }
        }
    }

    async processImageFile(filePath, retryCount) {
        try {
            // Resolve optimal variant path for this service
            const optimalPath = this.resolveOptimalVariant(filePath);
            
            // Use the /v2/analyze_file endpoint for file paths
            const fileServiceURL = this.serviceURL.replace('/v2/analyze', '/v2/analyze_file');
            console.log(`${this.serviceName} (v2) analyzing file via: ${fileServiceURL}`);

            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Request timeout')), this.timeout);
            });

            const axios = require('axios');
            const fetchPromise = axios.get(fileServiceURL, {
                params: {
                    file_path: optimalPath
                },
                headers: {
                    'Accept': 'application/json'
                },
                timeout: this.timeout
            });

            const response = await Promise.race([fetchPromise, timeoutPromise]);
            return this.processV2Response(response);

        } catch (error) {
            console.error(`${this.serviceName} (v2) file analysis error:`, error.message);

            if (retryCount < this.maxRetries) {
                console.log(`${this.serviceName} (v2) file analysis retrying... (${retryCount + 1}/${this.maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                return this.processImageFile(filePath, retryCount + 1);
            } else {
                throw new Error(`${this.serviceName} service failed after ${this.maxRetries} retries: ${error.message}`);
            }
        }
    }

    /**
     * Process unified v2 response format
     * All v2 services return the same structure, so no service-specific processing needed
     */
    processV2Response(response) {
        const data = response.data;
        
        // Validate v2 response structure
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

        // Return the unified v2 response as-is
        // The VotingService will extract what it needs from the predictions array
        return {
            success: true,
            data: data,
            service: data.service,
            predictions: data.predictions || [],
            metadata: data.metadata || {},
            processing_time: data.metadata?.processing_time || 0
        };
    }
}

module.exports = V2BaseMLService;