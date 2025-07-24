require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const sizeOf = require('image-size');
const axios = require('axios');

// Import ML services
const { services: mlServices, config: mlConfig } = require('./services');
// const V2VotingService = require('./services/V2VotingService');  // Original voting service - commented out for rollback
const V2SimpleVotingService = require('./services/V2SimpleVotingService');  // New simplified voting service
const BoundingBoxService = require('./services/BoundingBoxService');
const ResponseFormatter = require('./services/ResponseFormatter');

const app = express();
const PORT = process.env.PORT;
const API_HOST = process.env.API_HOST || 'localhost';
const UPLOAD_DIR = process.env.UPLOAD_DIR;
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE);

// Initialize services
// const votingService = new V2VotingService();  // Original voting service - commented out for rollback
const votingService = new V2SimpleVotingService();  // New simplified voting service
const boundingBoxService = new BoundingBoxService();
const responseFormatter = new ResponseFormatter();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('uploads'));

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, UPLOAD_DIR);
fs.mkdir(uploadsDir, { recursive: true }).catch(console.error);


// Helper function to download external image URLs
async function downloadExternalImage(imageUrl) {
    try {
        console.log(`Downloading external image: ${imageUrl}`);
        const response = await axios({
            method: 'get',
            url: imageUrl,
            responseType: 'stream',
            timeout: 30000, // 30 second timeout
            headers: {
                'User-Agent': 'Animal-Farm-API/1.0'
            }
        });

        // Generate unique filename
        const urlExtension = path.extname(new URL(imageUrl).pathname) || '.jpg';
        const filename = uuidv4() + urlExtension;
        const filepath = path.join(uploadsDir, filename);

        // Save stream to file
        const writer = require('fs').createWriteStream(filepath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                console.log(`Downloaded external image saved as: ${filename}`);
                resolve({ filepath, filename });
            });
            writer.on('error', reject);
        });
    } catch (error) {
        console.error(`Failed to download external image: ${error.message}`);
        throw new Error(`Failed to download image: ${error.message}`);
    }
}

// Multer configuration for file uploads
const storage = multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) => {
        const uniqueName = uuidv4() + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.'));
        }
    }
});

// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        // Quick check of all services
        const axios = require('axios');
        const serviceChecks = Object.entries(mlServices).map(async ([serviceName, service]) => {
            try {
                await axios.get(`${service.serviceURL.replace('/v2/analyze', '')}/health`, { timeout: 2000 });
                return { name: serviceName, status: 'healthy' };
            } catch (error) {
                return { name: serviceName, status: 'unhealthy' };
            }
        });
        
        const results = await Promise.allSettled(serviceChecks.map(p => p.catch(e => e)));
        const serviceStatuses = results.map(r => r.status === 'fulfilled' ? r.value : r.reason);
        const healthyCount = serviceStatuses.filter(s => s.status === 'healthy').length;
        const totalServices = serviceStatuses.length;
        
        const overallStatus = healthyCount === totalServices ? 'healthy' : 
                            healthyCount > totalServices/2 ? 'degraded' : 'critical';
        
        res.json({ 
            status: overallStatus,
            timestamp: new Date().toISOString(),
            healthy_services: `${healthyCount}/${totalServices}`,
            check_details: "/services/health"
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            timestamp: new Date().toISOString(),
            error: error.message
        });
    }
});

// Service health endpoint - real-time status of all ML services
app.get('/services/health', async (req, res) => {
    const startTime = Date.now();
    
    // Map service names to their systemd service names
    const systemdServiceMap = {
        'blip': 'blip-api.service',
        'clip': 'clip-api.service', 
        'yolo': 'yolo-api.service',
        'colors': 'colors-api.service',
        'detectron2': 'detectron-api.service',
        'face': 'face-api.service',
        'nsfw': 'nsfw-api.service',
        'ocr': 'ocr-api.service',
        'inception': 'inception-api.service',
        'rtdetr': 'rtdetr-api.service',
        'metadata': 'metadata-api.service',
        'ollama': 'llama-api.service'
    };
    
    const serviceHealthPromises = Object.entries(mlServices).map(async ([serviceName, service]) => {
        const serviceStartTime = Date.now();
        try {
            // Check both HTTP health and systemd status
            const axios = require('axios');
            const { exec } = require('child_process');
            const { promisify } = require('util');
            const execAsync = promisify(exec);
            
            // HTTP health check
            const httpPromise = axios.get(`${service.serviceURL.replace('/v2/analyze', '')}/health`, { timeout: 5000 });
            
            // Systemd status check (no sudo needed)
            const systemdService = systemdServiceMap[serviceName];
            const systemdPromise = systemdService ? 
                execAsync(`systemctl is-active ${systemdService}`).then(
                    result => ({ systemd_status: result.stdout.trim() }),
                    error => ({ systemd_status: 'inactive', systemd_error: error.message })
                ) : 
                Promise.resolve({ systemd_status: 'unknown' });
            
            const [httpResult, systemdResult] = await Promise.all([httpPromise, systemdPromise]);
            
            return {
                name: serviceName,
                status: 'healthy',
                response_time: Date.now() - serviceStartTime,
                last_check: new Date().toISOString(),
                systemd_service: systemdService || 'unknown',
                systemd_status: systemdResult.systemd_status,
                systemd_error: systemdResult.systemd_error
            };
        } catch (error) {
            // If HTTP fails, still try to get systemd status
            const systemdService = systemdServiceMap[serviceName];
            let systemdStatus = 'unknown';
            try {
                if (systemdService) {
                    const { exec } = require('child_process');
                    const { promisify } = require('util');
                    const execAsync = promisify(exec);
                    const result = await execAsync(`systemctl is-active ${systemdService}`);
                    systemdStatus = result.stdout.trim();
                }
            } catch (systemdError) {
                systemdStatus = 'inactive';
            }
            
            return {
                name: serviceName,
                status: error.code === 'ECONNREFUSED' ? 'offline' : 'error',
                response_time: Date.now() - serviceStartTime,
                error: error.message,
                last_check: new Date().toISOString(),
                systemd_service: systemdService || 'unknown',
                systemd_status: systemdStatus
            };
        }
    });

    const serviceHealthResults = await Promise.allSettled(serviceHealthPromises);
    const healthyCount = serviceHealthResults.filter(r => r.status === 'fulfilled' && r.value.status === 'healthy').length;
    const totalServices = serviceHealthResults.length;
    
    res.json({
        timestamp: new Date().toISOString(),
        overall_status: healthyCount === totalServices ? 'healthy' : healthyCount > totalServices/2 ? 'degraded' : 'critical',
        total_services: totalServices,
        healthy_services: healthyCount,
        check_time: Date.now() - startTime,
        services: serviceHealthResults.map(r => r.status === 'fulfilled' ? r.value : r.reason).sort((a, b) => a.name.localeCompare(b.name))
    });
});

// Main analysis endpoint for URL analysis - GET request  
app.get('/analyze', async (req, res) => {
    const imageUrl = req.query.url;
    
    if (!imageUrl) {
        return res.status(400).json({
            success: false,
            error: 'Missing required parameter: url'
        });
    }

    try {
        const result = await performAnalysisFromUrl(imageUrl);
        res.json(result);
    } catch (error) {
        console.error('Analysis error:', error);
        res.status(500).json({
            success: false,
            error: 'Analysis failed',
            details: error.message
        });
    }
});

// Main analysis endpoint for file uploads - POST request
app.post('/analyze', upload.single('image'), async (req, res) => {
    try {
        // Handle image input
        if (req.file) {
            const result = await performAnalysisFromFile(req.file);
            res.json(result);
        } else if (req.body.image_url) {
            const result = await performAnalysisFromUrl(req.body.image_url);
            res.json(result);
        } else {
            return res.status(400).json({
                success: false,
                error: 'No image provided. Use either file upload or image_url parameter.'
            });
        }
    } catch (error) {
        console.error('Analysis error:', error);
        res.status(500).json({
            success: false,
            error: 'Analysis failed',
            details: error.message
        });
    }
});

// File-based analysis endpoint - GET request for direct file paths
app.get('/analyze_file', async (req, res) => {
    const filePath = req.query.file_path;
    
    if (!filePath) {
        return res.status(400).json({
            success: false,
            error: 'Missing required parameter: file_path'
        });
    }

    try {
        const result = await performAnalysisFromFilePath(filePath);
        res.json(result);
    } catch (error) {
        console.error('File analysis error:', error);
        res.status(500).json({
            success: false,
            error: 'File analysis failed',
            details: error.message
        });
    }
});


// Analysis for URL-based requests
async function performAnalysisFromUrl(imageUrl) {
    const downloadResult = await downloadExternalImage(imageUrl);
    return await _performAnalysisCore({
        tempFilePath: downloadResult.filepath,
        imageUrl: `http://${API_HOST}:${PORT}/${downloadResult.filename}`,
        isFileUpload: false,
        originalUrl: imageUrl
    });
}

// Analysis for file upload requests  
async function performAnalysisFromFile(uploadedFile) {
    return await _performAnalysisCore({
        tempFilePath: uploadedFile.path,
        imageUrl: `http://${API_HOST}:${PORT}/${uploadedFile.filename}`,
        isFileUpload: true,
        originalUrl: null
    });
}

// Analysis for direct file path requests - optimized for local files
async function performAnalysisFromFilePath(filePath) {
    return await _performAnalysisCoreFile({
        filePath: filePath,
        isFileUpload: false,
        originalUrl: null
    });
}

// Shared core analysis logic
async function _performAnalysisCore({ tempFilePath, imageUrl, isFileUpload, originalUrl }) {
    const startTime = Date.now();
    let imageDimensions = null;

    try {
        // Measure image dimensions
        try {
            imageDimensions = sizeOf.default(require('fs').readFileSync(tempFilePath));
            console.log(`Image dimensions: ${imageDimensions.width}x${imageDimensions.height}`);
        } catch (dimensionError) {
            console.warn(`Failed to measure image dimensions: ${dimensionError.message}`);
            imageDimensions = null;
        }

        const imageId = uuidv4();
        console.log(`Starting analysis for image: ${imageId}`);
        console.log(`Image URL: ${imageUrl}`);

        // Call all available ML services in parallel
        const mlStartTime = Date.now();
        console.log(`Starting ML services at: ${mlStartTime - startTime}ms`);
        
        const servicePromises = Object.entries(mlServices).map(([serviceName, service]) => 
            service.analyze(imageUrl)
                .then(result => ({ serviceName, result }))
                .catch(error => {
                    error.serviceName = serviceName;
                    throw error;
                })
        );

        const serviceResults = await Promise.allSettled(servicePromises);
        const mlEndTime = Date.now();
        const mlDuration = mlEndTime - mlStartTime;
        const analysisTime = (Date.now() - startTime) / 1000;
        console.log(`ML services completed in: ${mlDuration}ms`);

        // Process results with service status tracking
        const processingStartTime = Date.now();
        const results = {};
        const serviceStatusList = [];
        
        serviceResults.forEach(promiseResult => {
            if (promiseResult.status === 'fulfilled') {
                const { serviceName, result } = promiseResult.value;
                results[serviceName] = result;
                
                const predictionCount = result.data?.predictions?.length || 0;
                const processingTime = result.processing_time || result.data?.metadata?.processing_time || 0;
                
                serviceStatusList.push({
                    service: serviceName,
                    status: 'success',
                    predictions: predictionCount,
                    time: Math.round(processingTime * 1000)
                });
                
            } else {
                const serviceName = promiseResult.reason.serviceName || 'unknown';
                const errorMessage = promiseResult.reason.message || 'Unknown error';
                
                console.error(`Service failed: ${serviceName} - ${errorMessage}`);
                
                serviceStatusList.push({
                    service: serviceName,
                    status: promiseResult.reason.message.includes('timeout') ? 'timeout' : 'error',
                    error: errorMessage,
                    predictions: 0,
                    time: 0
                });
            }
        });
        
        const processingEndTime = Date.now();
        console.log(`Result processing completed in: ${processingEndTime - processingStartTime}ms`);

        // Apply voting algorithm
        const votingStartTime = Date.now();
        const votingResults = votingService.processVotes(results);
        const votingEndTime = Date.now();
        console.log(`Voting algorithm completed in: ${votingEndTime - votingStartTime}ms`);
        
        // Process bounding boxes
        const bboxStartTime = Date.now();
        const winningEmojis = votingResults.emoji_predictions.first_place?.map(item => item.emoji) || [];
        const boundingBoxData = await boundingBoxService.processBoundingBoxes(
            results,
            imageDimensions,
            winningEmojis
        );
        const bboxEndTime = Date.now();
        console.log(`Bounding box processing completed in: ${bboxEndTime - bboxStartTime}ms`);

        // Extract captions
        const captionStartTime = Date.now();
        const captions = {};
        
        if (results.blip?.data?.predictions) {
            const captionPrediction = results.blip.data.predictions.find(p => p.type === 'caption');
            if (captionPrediction?.text) {
                captions.blip = captionPrediction.text;
            }
        }
        
        if (results.ollama?.data?.predictions) {
            const captionPrediction = results.ollama.data.predictions.find(p => p.type === 'caption');
            if (captionPrediction?.text) {
                captions.llama = captionPrediction.text;
            }
        }

        // Score captions
        const captionScores = votingService.scoreCaptions(captions, votingResults, results);
        const captionEndTime = Date.now();
        console.log(`Caption processing completed in: ${captionEndTime - captionStartTime}ms`);

        // Return response using ResponseFormatter
        const responseStartTime = Date.now();
        
        // Check for degraded services and add health summary if needed
        const failedServices = serviceStatusList.filter(s => s.status !== 'success');
        const healthSummary = failedServices.length > 0 ? {
            degraded_services: failedServices.map(s => s.service),
            failed_count: failedServices.length,
            total_services: serviceStatusList.length,
            check_health_endpoint: "GET /services/health"
        } : null;
        
        // Log service failures prominently
        if (failedServices.length > 0) {
            console.log(`🚨 WARNING: ${failedServices.length} services failed - check /services/health`);
            console.log(`Failed services: ${failedServices.map(s => s.service).join(', ')}`);
        }
        
        const response = responseFormatter.createCompactResponse({
            imageId,
            analysisTime,
            imageDimensions,
            imageUrl,
            isFileUpload,
            originalUrl,
            serviceStatusList,
            votingResults,
            captions,
            captionScores,
            boundingBoxData,
            results,
            healthSummary
        });
        const responseEndTime = Date.now();
        console.log(`Response formatting completed in: ${responseEndTime - responseStartTime}ms`);
        
        const totalTime = Date.now() - startTime;
        console.log(`Total processing time: ${totalTime}ms`);
        console.log(`Time breakdown:`);
        console.log(`  - ML Services: ${mlDuration}ms`);
        console.log(`  - Result Processing: ${processingEndTime - processingStartTime}ms`);
        console.log(`  - Voting: ${votingEndTime - votingStartTime}ms`);
        console.log(`  - Bounding Boxes: ${bboxEndTime - bboxStartTime}ms`);
        console.log(`  - Caption Processing: ${captionEndTime - captionStartTime}ms`);
        console.log(`  - Response Formatting: ${responseEndTime - responseStartTime}ms`);
        console.log(`  - Unaccounted time: ${totalTime - mlDuration - (processingEndTime - processingStartTime) - (votingEndTime - votingStartTime) - (bboxEndTime - bboxStartTime) - (captionEndTime - captionStartTime) - (responseEndTime - responseStartTime)}ms`);

        return response;

    } finally {
        // Cleanup uploaded file
        if (tempFilePath) {
            try {
                await require('fs').promises.unlink(tempFilePath);
            } catch (error) {
                console.warn('Failed to cleanup temp file:', error.message);
            }
        }
    }
}

// Optimized file-based analysis core - eliminates HTTP overhead
async function _performAnalysisCoreFile({ filePath, isFileUpload, originalUrl }) {
    const startTime = Date.now();
    let imageDimensions = null;

    try {
        // Validate file exists
        const fs = require('fs');
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        // Measure image dimensions
        try {
            imageDimensions = sizeOf.default(fs.readFileSync(filePath));
            console.log(`Image dimensions: ${imageDimensions.width}x${imageDimensions.height}`);
        } catch (dimensionError) {
            console.warn(`Failed to measure image dimensions: ${dimensionError.message}`);
            imageDimensions = null;
        }

        const imageId = uuidv4();
        console.log(`Starting file-based analysis for image: ${imageId}`);
        console.log(`File path: ${filePath}`);

        // Call all available ML services using file paths - NO HTTP OVERHEAD! 🚀
        const mlStartTime = Date.now();
        console.log(`Starting ML services (FILE-BASED) at: ${mlStartTime - startTime}ms`);
        
        const servicePromises = Object.entries(mlServices).map(([serviceName, service]) => 
            service.analyzeFile(filePath)  // Use the new analyzeFile method!
                .then(result => ({ serviceName, result }))
                .catch(error => {
                    error.serviceName = serviceName;
                    throw error;
                })
        );

        const serviceResults = await Promise.allSettled(servicePromises);
        const mlEndTime = Date.now();
        const mlDuration = mlEndTime - mlStartTime;
        const analysisTime = (Date.now() - startTime) / 1000;
        console.log(`ML services (FILE-BASED) completed in: ${mlDuration}ms`);

        // Process results with service status tracking
        const processingStartTime = Date.now();
        const results = {};
        const serviceStatusList = [];
        
        serviceResults.forEach(promiseResult => {
            if (promiseResult.status === 'fulfilled') {
                const { serviceName, result } = promiseResult.value;
                results[serviceName] = result;
                
                const predictionCount = result.data?.predictions?.length || 0;
                const processingTime = result.processing_time || result.data?.metadata?.processing_time || 0;
                
                serviceStatusList.push({
                    service: serviceName,
                    status: 'success',
                    predictions: predictionCount,
                    time: Math.round(processingTime * 1000)
                });
                
            } else {
                const serviceName = promiseResult.reason.serviceName || 'unknown';
                const errorMessage = promiseResult.reason.message || 'Unknown error';
                
                console.error(`Service failed: ${serviceName} - ${errorMessage}`);
                
                serviceStatusList.push({
                    service: serviceName,
                    status: promiseResult.reason.message.includes('timeout') ? 'timeout' : 'error',
                    error: errorMessage,
                    predictions: 0,
                    time: 0
                });
            }
        });
        
        const processingEndTime = Date.now();
        console.log(`Result processing completed in: ${processingEndTime - processingStartTime}ms`);

        // Apply voting algorithm
        const votingStartTime = Date.now();
        const votingResults = votingService.processVotes(results);
        const votingEndTime = Date.now();
        console.log(`Voting algorithm completed in: ${votingEndTime - votingStartTime}ms`);
        
        // Process bounding boxes
        const bboxStartTime = Date.now();
        const winningEmojis = votingResults.emoji_predictions.first_place?.map(item => item.emoji) || [];
        const boundingBoxData = await boundingBoxService.processBoundingBoxes(
            results,
            imageDimensions,
            winningEmojis
        );
        const bboxEndTime = Date.now();
        console.log(`Bounding box processing completed in: ${bboxEndTime - bboxStartTime}ms`);

        // Extract captions
        const captionStartTime = Date.now();
        const captions = {};
        
        if (results.blip?.data?.predictions) {
            const captionPrediction = results.blip.data.predictions.find(p => p.type === 'caption');
            if (captionPrediction?.text) {
                captions.blip = captionPrediction.text;
            }
        }
        
        if (results.ollama?.data?.predictions) {
            const captionPrediction = results.ollama.data.predictions.find(p => p.type === 'caption');
            if (captionPrediction?.text) {
                captions.llama = captionPrediction.text;
            }
        }

        // Score captions
        const captionScores = votingService.scoreCaptions(captions, votingResults, results);
        const captionEndTime = Date.now();
        console.log(`Caption processing completed in: ${captionEndTime - captionStartTime}ms`);

        // Return response using ResponseFormatter
        const responseStartTime = Date.now();
        
        // Check for degraded services and add health summary if needed
        const failedServices = serviceStatusList.filter(s => s.status !== 'success');
        const healthSummary = failedServices.length > 0 ? {
            degraded_services: failedServices.map(s => s.service),
            failed_count: failedServices.length,
            total_services: serviceStatusList.length,
            check_health_endpoint: "GET /services/health"
        } : null;
        
        // Log service failures prominently
        if (failedServices.length > 0) {
            console.log(`🚨 WARNING: ${failedServices.length} services failed - check /services/health`);
            console.log(`Failed services: ${failedServices.map(s => s.service).join(', ')}`);
        }
        
        const response = responseFormatter.createCompactResponse({
            imageId,
            analysisTime,
            imageDimensions,
            imageUrl: null, // No imageUrl for file-based analysis
            isFileUpload,
            originalUrl,
            serviceStatusList,
            votingResults,
            captions,
            captionScores,
            boundingBoxData,
            results,
            healthSummary,
            filePath  // Include file path in response
        });
        const responseEndTime = Date.now();
        console.log(`Response formatting completed in: ${responseEndTime - responseStartTime}ms`);
        
        const totalTime = Date.now() - startTime;
        console.log(`🚀 FILE-BASED ANALYSIS - Total processing time: ${totalTime}ms`);
        console.log(`⚡ PERFORMANCE BOOST: Eliminated HTTP overhead!`);
        console.log(`Time breakdown:`);
        console.log(`  - ML Services (FILE): ${mlDuration}ms`);
        console.log(`  - Result Processing: ${processingEndTime - processingStartTime}ms`);
        console.log(`  - Voting: ${votingEndTime - votingStartTime}ms`);
        console.log(`  - Bounding Boxes: ${bboxEndTime - bboxStartTime}ms`);
        console.log(`  - Caption Processing: ${captionEndTime - captionStartTime}ms`);
        console.log(`  - Response Formatting: ${responseEndTime - responseStartTime}ms`);

        return response;

    } catch (error) {
        console.error('File-based analysis error:', error);
        throw error;
    }
    // No cleanup needed for file-based analysis - we don't own the file
}

// Emoji mappings endpoint
app.get('/emoji_mappings.json', (req, res) => {
    const filePath = path.join(__dirname, 'emoji_mappings.json');
    res.sendFile(filePath, (err) => {
        if (err) {
            console.error('Error serving emoji mappings:', err);
            res.status(500).json({
                success: false,
                error: 'Failed to serve emoji mappings file'
            });
        }
    });
});

// Multi-Word Expressions (MWE) mappings endpoint
app.get('/mwe.txt', (req, res) => {
    const filePath = path.join(__dirname, 'mwe.txt');
    res.sendFile(filePath, (err) => {
        if (err) {
            console.error('Error serving multi-word expressions (MWE) mapping file:', err);
            res.status(500).json({
                success: false,
                error: 'Failed to serve multi-word expressions mapping file.'
            });
        }
    });
});

// Error handling middleware
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                error: `File too large. Maximum size is ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB.`
            });
        }
    }
    
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        details: error.message
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Animal Farm API running on port ${PORT}`);
    console.log(`📡 Health check: http://localhost:${PORT}/health`);
    console.log(`📊 Analysis endpoint: POST http://localhost:${PORT}/analyze`);
    console.log(`🎯 Services: ${Object.keys(mlConfig).join(', ')}`);
});

module.exports = app;
