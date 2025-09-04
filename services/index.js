/**
 * ML Services Module
 * Exports all ML service clients and configuration
 */

// V3 services use native v3 response formats
const V3BaseMLService = require('./V3BaseMLService');
const CLIPCaptionScoringService = require('./CLIPCaptionScoringService');

// ML Service Configuration - Each service can have its own host/port
const ML_SERVICES_CONFIG = {
    // Default server configuration
    defaults: {
        protocol: process.env.ML_PROTOCOL || 'http',
        host: process.env.ML_HOST || '127.0.0.1' // Fallback to localhost
    },
    
    // ML Service Endpoints - All services now use v3/analyze with unified schema
    services: {
        blip: {
            host: process.env.BLIP_HOST,
            port: process.env.BLIP_PORT,
            endpoint: '/v3/analyze',
            name: 'BLIP',
            optimalSize: '384'
        },
        clip: {
            host: process.env.CLIP_HOST,
            port: process.env.CLIP_PORT,
            endpoint: '/v3/analyze',
            name: 'CLIP-Detection',
            optimalSize: '224'
        },
        yolo: {
            host: process.env.YOLO_HOST,
            port: process.env.YOLO_PORT,
            endpoint: '/v3/analyze',
            name: 'YOLO',
            optimalSize: '640'
        },
        colors: {
            host: process.env.COLORS_HOST,
            port: process.env.COLORS_PORT,
            endpoint: '/v3/analyze',
            name: 'Colors',
            optimalSize: '400'
        },
        detectron2: {
            host: process.env.DETECTRON2_HOST,
            port: process.env.DETECTRON2_PORT,
            endpoint: '/v3/analyze',
            name: 'Detectron2',
            optimalSize: '512'
        },
        face: {
            host: process.env.FACE_HOST,
            port: process.env.FACE_PORT,
            endpoint: '/v3/analyze',
            name: 'Face',
            optimalSize: 'original'
        },
        nsfw: {
            host: process.env.NSFW_HOST,
            port: process.env.NSFW_PORT,
            endpoint: '/v3/analyze',
            name: 'NSFW',
            optimalSize: '480'
        },
        ocr: {
            host: process.env.OCR_HOST,
            port: process.env.OCR_PORT,
            endpoint: '/v3/analyze',
            name: 'OCR',
            optimalSize: '800'
        },
        inception: {
            host: process.env.INCEPTION_HOST,
            port: process.env.INCEPTION_PORT,
            endpoint: '/v3/analyze',
            name: 'Xception-Detection',
            optimalSize: '299'
        },
        // inception_v4: {
        //     host: process.env.INCEPTION_V4_HOST,
        //     port: process.env.INCEPTION_V4_PORT,
        //     endpoint: '/v3/analyze',
        //     name: 'Inception v4'
        // },
        rtdetr: {
            host: process.env.RTDETR_HOST,
            port: process.env.RTDETR_PORT,
            endpoint: '/v3/analyze',
            name: 'RT-DETR',
            optimalSize: '640'
        },
        metadata: {
            host: process.env.METADATA_HOST,
            port: process.env.METADATA_PORT,
            endpoint: '/v3/analyze',
            name: 'Metadata',
            optimalSize: 'original'
        },
        ollama: {
            host: process.env.OLLAMA_HOST,
            port: process.env.OLLAMA_PORT,
            endpoint: '/v3/analyze',
            name: 'Ollama',
            optimalSize: '512'
        },
        yolo_365: {
            host: process.env.YOLO_365_HOST,
            port: process.env.YOLO_365_PORT,
            endpoint: '/v3/analyze',
            name: 'YOLO-365',
            optimalSize: '640'
        },
        yolo_oi7: {
            host: process.env.YOLO_OI7_HOST,
            port: process.env.YOLO_OI7_PORT,
            endpoint: '/v3/analyze',
            name: 'YOLO-OI7',
            optimalSize: '640'
        },
        clip_scoring: {
            host: process.env.CLIP_SCORING_HOST,
            port: process.env.CLIP_SCORING_PORT,
            endpoint: '/v3/analyze',
            name: 'CLIP-Scoring',
            optimalSize: '224'
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

// Initialize service clients using V3 service class
const services = {
    blip: new V3BaseMLService(getServiceConfig('blip')),
    clip: new V3BaseMLService(getServiceConfig('clip')),
    yolo: new V3BaseMLService(getServiceConfig('yolo')),
    colors: new V3BaseMLService(getServiceConfig('colors')),
    detectron2: new V3BaseMLService(getServiceConfig('detectron2')),
    face: new V3BaseMLService(getServiceConfig('face')),
    nsfw: new V3BaseMLService(getServiceConfig('nsfw')),
    ocr: new V3BaseMLService(getServiceConfig('ocr')),
    inception: new V3BaseMLService(getServiceConfig('inception')),
    // inception_v4: new V3BaseMLService(getServiceConfig('inception_v4')),
    rtdetr: new V3BaseMLService(getServiceConfig('rtdetr')),
    metadata: new V3BaseMLService(getServiceConfig('metadata')),
    ollama: new V3BaseMLService(getServiceConfig('ollama')),
    yolo_365: new V3BaseMLService(getServiceConfig('yolo_365')),
    yolo_oi7: new V3BaseMLService(getServiceConfig('yolo_oi7'))
};

// Specialized services (not part of main ML analysis pipeline)
const clipScoring = new CLIPCaptionScoringService(getServiceConfig('clip_scoring'));

module.exports = {
    services,
    clipScoring,
    config: ML_SERVICES_CONFIG,
    getServiceConfig
};