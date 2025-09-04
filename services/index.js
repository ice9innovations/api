/**
 * ML Services Module
 * Exports all ML service clients and configuration
 * 
 * Modernized to load from service_config.json with backward compatibility
 */

const path = require('path');
const fs = require('fs');

// V3 services use native v3 response formats
const V3BaseMLService = require('./V3BaseMLService');
const CLIPCaptionScoringService = require('./CLIPCaptionScoringService');

// Load service configuration from service_config.json with fallback to env vars
function loadServiceConfig() {
    const configPath = path.join(__dirname, '..', 'service_config.json');
    let serviceConfig = {};
    
    try {
        const configFile = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(configFile);
        serviceConfig = config.services || {};
        console.log(`📋 Loaded service configuration from service_config.json (${Object.keys(serviceConfig).length} services)`);
    } catch (error) {
        console.warn(`⚠️ Could not load service_config.json: ${error.message}`);
        console.log(`📋 Falling back to environment variable configuration`);
    }
    
    return serviceConfig;
}

const SERVICE_CONFIG_JSON = loadServiceConfig();

// Generate services configuration from service_config.json with backward compatibility
function generateServicesConfig() {
    const services = {};
    
    // Service name mapping from service_config.json to API naming
    const serviceNameMap = {
        'yolov8': 'yolo',           // API uses 'yolo' for YOLOv8
        'xception': 'inception',     // API uses 'inception' for Xception-Detection  
        'nsfw2': 'nsfw',            // API uses 'nsfw' for NSFW2
        'caption_score': 'clip_scoring'  // API uses 'clip_scoring' for caption scoring
    };
    
    // Default service display names and optimal sizes
    const serviceDefaults = {
        blip: { name: 'BLIP', optimalSize: '384' },
        clip: { name: 'CLIP-Detection', optimalSize: '224' },
        yolo: { name: 'YOLO', optimalSize: '640' },
        colors: { name: 'Colors', optimalSize: '400' },
        detectron2: { name: 'Detectron2', optimalSize: '512' },
        face: { name: 'Face', optimalSize: 'original' },
        nsfw: { name: 'NSFW', optimalSize: '480' },
        ocr: { name: 'OCR', optimalSize: '800' },
        inception: { name: 'Xception-Detection', optimalSize: '299' },
        rtdetr: { name: 'RT-DETR', optimalSize: '640' },
        metadata: { name: 'Metadata', optimalSize: 'original' },
        ollama: { name: 'Ollama', optimalSize: '512' },
        yolo_365: { name: 'YOLO-365', optimalSize: '640' },
        yolo_oi7: { name: 'YOLO-OI7', optimalSize: '640' },
        clip_scoring: { name: 'CLIP-Scoring', optimalSize: '224' }
    };
    
    // Create services from service_config.json
    for (const [configKey, serviceConfig] of Object.entries(SERVICE_CONFIG_JSON)) {
        const apiKey = serviceNameMap[configKey] || configKey;
        const defaults = serviceDefaults[apiKey] || { name: apiKey, optimalSize: '512' };
        
        services[apiKey] = {
            host: serviceConfig.host,
            port: serviceConfig.port,
            endpoint: serviceConfig.endpoint,
            name: defaults.name,
            optimalSize: defaults.optimalSize,
            category: serviceConfig.category,
            service_type: serviceConfig.service_type,
            description: serviceConfig.description
        };
    }
    
    // Fallback to environment variables for any missing services
    const envFallbacks = {
        blip: { host: process.env.BLIP_HOST, port: process.env.BLIP_PORT },
        clip: { host: process.env.CLIP_HOST, port: process.env.CLIP_PORT },
        yolo: { host: process.env.YOLO_HOST, port: process.env.YOLO_PORT },
        colors: { host: process.env.COLORS_HOST, port: process.env.COLORS_PORT },
        detectron2: { host: process.env.DETECTRON2_HOST, port: process.env.DETECTRON2_PORT },
        face: { host: process.env.FACE_HOST, port: process.env.FACE_PORT },
        nsfw: { host: process.env.NSFW_HOST, port: process.env.NSFW_PORT },
        ocr: { host: process.env.OCR_HOST, port: process.env.OCR_PORT },
        inception: { host: process.env.INCEPTION_HOST, port: process.env.INCEPTION_PORT },
        rtdetr: { host: process.env.RTDETR_HOST, port: process.env.RTDETR_PORT },
        metadata: { host: process.env.METADATA_HOST, port: process.env.METADATA_PORT },
        ollama: { host: process.env.OLLAMA_HOST, port: process.env.OLLAMA_PORT },
        yolo_365: { host: process.env.YOLO_365_HOST, port: process.env.YOLO_365_PORT },
        yolo_oi7: { host: process.env.YOLO_OI7_HOST, port: process.env.YOLO_OI7_PORT },
        clip_scoring: { host: process.env.CLIP_SCORING_HOST, port: process.env.CLIP_SCORING_PORT }
    };
    
    // Add any missing services from environment variables
    for (const [serviceName, envConfig] of Object.entries(envFallbacks)) {
        if (!services[serviceName] && envConfig.host && envConfig.port) {
            const defaults = serviceDefaults[serviceName] || { name: serviceName, optimalSize: '512' };
            services[serviceName] = {
                host: envConfig.host,
                port: envConfig.port,
                endpoint: '/v3/analyze',
                name: defaults.name,
                optimalSize: defaults.optimalSize
            };
        }
    }
    
    return services;
}

// ML Service Configuration - Modern pattern with backward compatibility
const ML_SERVICES_CONFIG = {
    // Default server configuration
    defaults: {
        protocol: process.env.ML_PROTOCOL || 'http',
        host: process.env.ML_HOST || '127.0.0.1' // Fallback to localhost
    },
    
    // Generate services dynamically from service_config.json with env var fallbacks
    services: generateServicesConfig()
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