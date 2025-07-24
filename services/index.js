/**
 * ML Services Module
 * Exports all ML service clients and configuration
 */

// V2 services use unified response format, so we only need one service class
const V2MLService = require('./V2MLService');

// ML Service Configuration - Each service can have its own host/port
const ML_SERVICES_CONFIG = {
    // Default server configuration
    defaults: {
        protocol: process.env.ML_PROTOCOL || 'http',
        host: process.env.ML_HOST || '127.0.0.1' // Fallback to localhost
    },
    
    // ML Service Endpoints - All services now use v2/analyze with unified schema
    services: {
        blip: {
            host: process.env.BLIP_HOST,
            port: process.env.BLIP_PORT,
            endpoint: '/v2/analyze',
            name: 'BLIP',
            optimalSize: '384'
        },
        clip: {
            host: process.env.CLIP_HOST,
            port: process.env.CLIP_PORT,
            endpoint: '/v2/analyze',
            name: 'CLIP',
            optimalSize: '224'
        },
        yolo: {
            host: process.env.YOLO_HOST,
            port: process.env.YOLO_PORT,
            endpoint: '/v2/analyze',
            name: 'YOLO',
            optimalSize: '640'
        },
        colors: {
            host: process.env.COLORS_HOST,
            port: process.env.COLORS_PORT,
            endpoint: '/v2/analyze',
            name: 'Colors',
            optimalSize: '400'
        },
        detectron2: {
            host: process.env.DETECTRON2_HOST,
            port: process.env.DETECTRON2_PORT,
            endpoint: '/v2/analyze',
            name: 'Detectron2',
            optimalSize: '512'
        },
        face: {
            host: process.env.FACE_HOST,
            port: process.env.FACE_PORT,
            endpoint: '/v2/analyze',
            name: 'Face',
            optimalSize: 'original'
        },
        nsfw: {
            host: process.env.NSFW_HOST,
            port: process.env.NSFW_PORT,
            endpoint: '/v2/analyze',
            name: 'NSFW',
            optimalSize: '480'
        },
        ocr: {
            host: process.env.OCR_HOST,
            port: process.env.OCR_PORT,
            endpoint: '/v2/analyze',
            name: 'OCR',
            optimalSize: '800'
        },
        inception: {
            host: process.env.INCEPTION_HOST,
            port: process.env.INCEPTION_PORT,
            endpoint: '/v2/analyze',
            name: 'Inception',
            optimalSize: '299'
        },
        // inception_v4: {
        //     host: process.env.INCEPTION_V4_HOST,
        //     port: process.env.INCEPTION_V4_PORT,
        //     endpoint: '/v2/analyze',
        //     name: 'Inception v4'
        // },
        rtdetr: {
            host: process.env.RTDETR_HOST,
            port: process.env.RTDETR_PORT,
            endpoint: '/v2/analyze',
            name: 'RT-DETR',
            optimalSize: '640'
        },
        metadata: {
            host: process.env.METADATA_HOST,
            port: process.env.METADATA_PORT,
            endpoint: '/v2/analyze',
            name: 'Metadata',
            optimalSize: 'original'
        },
        ollama: {
            host: process.env.OLLAMA_HOST,
            port: process.env.OLLAMA_PORT,
            endpoint: '/v2/analyze',
            name: 'Ollama',
            optimalSize: '512'
        }
    }
};

// Helper function to build full service config (like browser getMLServiceURL)
function getServiceConfig(serviceName) {
    const service = ML_SERVICES_CONFIG.services[serviceName];
    if (!service) {
        throw new Error(`Unknown service: ${serviceName}`);
    }
    
    return {
        host: service.host || ML_SERVICES_CONFIG.defaults.host,
        port: service.port,
        endpoint: service.endpoint,
        name: service.name,
        optimalSize: service.optimalSize || 'original'
    };
}

// Initialize service clients using the unified V2 service class
const services = {
    blip: new V2MLService(getServiceConfig('blip')),
    clip: new V2MLService(getServiceConfig('clip')),
    yolo: new V2MLService(getServiceConfig('yolo')),
    colors: new V2MLService(getServiceConfig('colors')),
    detectron2: new V2MLService(getServiceConfig('detectron2')),
    face: new V2MLService(getServiceConfig('face')),
    nsfw: new V2MLService(getServiceConfig('nsfw')),
    ocr: new V2MLService(getServiceConfig('ocr')),
    inception: new V2MLService(getServiceConfig('inception')),
    // inception_v4: new V2MLService(getServiceConfig('inception_v4')),
    rtdetr: new V2MLService(getServiceConfig('rtdetr')),
    metadata: new V2MLService(getServiceConfig('metadata')),
    ollama: new V2MLService(getServiceConfig('ollama'))
};

module.exports = {
    services,
    config: ML_SERVICES_CONFIG,
    getServiceConfig
};