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
const V3VotingService = require('./services/V3VotingService');  // V3 voting service
const BoundingBoxService = require('./services/BoundingBoxService');
const CaptionAggregationService = require('./services/CaptionAggregationService');
const ResponseFormatter = require('./services/ResponseFormatter');

const app = express();
const PORT = process.env.PORT;
const API_HOST = process.env.API_HOST || 'localhost';
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT}`;
const UPLOAD_DIR = process.env.UPLOAD_DIR;
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE);

// Initialize services
// const votingService = new V2VotingService();  // Original voting service - commented out for rollback
const votingService = new V3VotingService();  // V3 voting service
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
                await axios.get(`${service.serviceURL.replace('/v3/analyze', '')}/health`, { timeout: 10000 });
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
    
    const serviceHealthPromises = Object.entries(mlServices).map(async ([serviceName, service]) => {
        const serviceStartTime = Date.now();
        try {
            // HTTP health check only - services self-report their status
            const axios = require('axios');
            const healthURL = `${service.serviceURL.replace('/v3/analyze', '')}/health`;
            
            await axios.get(healthURL, { timeout: 10000 });
            
            return {
                name: serviceName,
                status: 'healthy',
                response_time: Date.now() - serviceStartTime,
                last_check: new Date().toISOString(),
                health_endpoint: healthURL
            };
        } catch (error) {
            return {
                name: serviceName,
                status: error.code === 'ECONNREFUSED' ? 'offline' : 'error',
                response_time: Date.now() - serviceStartTime,
                error: error.message,
                last_check: new Date().toISOString(),
                health_endpoint: `${service.serviceURL.replace('/v3/analyze', '')}/health`
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

// Unified analysis endpoint - handles URL, file upload, and direct file path
app.get('/analyze', async (req, res) => {
    let filePath;
    let needsCleanup = false;
    let imageUrl = null;
    let originalUrl = null;
    let isFileUpload = false;

    try {
        if (req.query.url) {
            // Download from URL
            const downloadResult = await downloadExternalImage(req.query.url);
            filePath = downloadResult.filepath;
            imageUrl = `${PUBLIC_URL}/${downloadResult.filename}`;
            originalUrl = req.query.url;
            needsCleanup = true;
            isFileUpload = false;
        } else if (req.query.file) {
            // Use local file path
            filePath = req.query.file;
            needsCleanup = false;
            isFileUpload = false;
        } else {
            return res.status(400).json({
                success: false,
                error: "Must provide either 'url' or 'file' parameter"
            });
        }

        const result = await performAnalysis({
            filePath,
            imageUrl,
            originalUrl,
            isFileUpload
        });
        res.json(result);
    } catch (error) {
        console.error('Analysis error:', error);
        res.status(500).json({
            success: false,
            error: 'Analysis failed',
            details: error.message
        });
    } finally {
        if (needsCleanup && filePath) {
            try {
                await require('fs').promises.unlink(filePath);
            } catch (cleanupError) {
                console.warn('Failed to cleanup temp file:', cleanupError.message);
            }
        }
    }
});

// File upload endpoint - POST for uploading files (RESTful)
app.post('/analyze', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No file uploaded. Use multipart form data with an image file.'
            });
        }

        // File upload
        const filePath = req.file.path;
        const imageUrl = `${PUBLIC_URL}/${req.file.filename}`;
        const isFileUpload = true;

        const result = await performAnalysis({
            filePath,
            imageUrl,
            originalUrl: null,
            isFileUpload
        });
        res.json(result);
    } catch (error) {
        console.error('Analysis error:', error);
        res.status(500).json({
            success: false,
            error: 'Analysis failed',
            details: error.message
        });
    }
    // Note: No cleanup needed - multer handles file lifecycle
});


// Single analysis function - always works with local file paths
async function performAnalysis({ filePath, imageUrl, originalUrl, isFileUpload }) {
    const startTime = Date.now();
    let imageDimensions = null;

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
    const analysisType = imageUrl ? 'URL-BASED' : 'FILE-BASED';
    console.log(`Starting ${analysisType} analysis for image: ${imageId}`);
    if (imageUrl) {
        console.log(`Image URL: ${imageUrl}`);
        console.log(`Original URL: ${originalUrl}`);
    } else {
        console.log(`File path: ${filePath}`);
    }

    // Call all available ML services - smart strategy based on input type
    const mlStartTime = Date.now();
    const serviceCallStrategy = originalUrl ? 'URL-BASED' : 'FILE-BASED';
    console.log(`Starting ML services (${serviceCallStrategy}) at: ${mlStartTime - startTime}ms`);
    
    const servicePromises = Object.entries(mlServices).map(([serviceName, service]) => {
        // Smart strategy:
        // - originalUrl exists: Downloaded from external URL -> use local URL (works with distributed services)
        // - no originalUrl: Direct file path -> use file path (requires local/shared filesystem)
        const inputParam = originalUrl ? imageUrl : filePath;
        
        return service.analyze(inputParam)
            .then(result => ({ serviceName, result }))
            .catch(error => {
                error.serviceName = serviceName;
                throw error;
            });
    });

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
            serviceStatusList.push({
                service: serviceName,
                status: 'success',
                time: result.metadata?.processing_time || 0,
                predictions: result.predictions?.length || 0
            });
        } else {
            const { serviceName } = promiseResult.reason;
            const errorMessage = promiseResult.reason.message || 'Unknown error';
            console.error(`Service ${serviceName} failed:`, errorMessage);
            results[serviceName] = { 
                success: false, 
                error: errorMessage,
                predictions: [],
                metadata: { processing_time: 0 }
            };
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

    // Process bounding boxes for ALL detections (no preliminary voting needed)
    const bboxStartTime = Date.now();
    const boundingBoxData = await boundingBoxService.processBoundingBoxes(
        results,
        imageDimensions,
        [] // Process ALL detections - let BoundingBoxService handle everything
    );
    const bboxEndTime = Date.now();
    console.log(`Bounding box processing completed in: ${bboxEndTime - bboxStartTime}ms`);
    
    // Apply voting algorithm with access to processed spatial data
    const votingStartTime = Date.now();
    const votingResults = votingService.processVotes(results, boundingBoxData);
    const votingEndTime = Date.now();
    console.log(`Voting algorithm completed in: ${votingEndTime - votingStartTime}ms`);

    // Aggregate and score captions using dedicated service (now includes CLIP similarity scoring)
    const captionStartTime = Date.now();
    const captionService = new CaptionAggregationService();
    const captionsData = await captionService.aggregateCaptions(results, votingResults, filePath);
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
    
    // Determine processing method and response data
    let processingMethod;
    if (originalUrl) {
        processingMethod = 'external_url_downloaded';
    } else if (isFileUpload) {
        processingMethod = 'file_upload';
    } else if (filePath && !originalUrl && !isFileUpload) {
        processingMethod = 'direct_file_access';
    } else {
        throw new Error('Unable to determine processing method');
    }

    const response = responseFormatter.createCompactResponse({
        imageId,
        analysisTime,
        imageDimensions,
        imageUrl: originalUrl || isFileUpload ? imageUrl : null,
        filePath: !originalUrl && !isFileUpload ? filePath : null,
        processingMethod,
        isFileUpload,
        originalUrl: originalUrl || null,
        serviceStatusList,
        votingResults,
        captionsData,
        boundingBoxData,
        results,
        healthSummary
    });
    const responseEndTime = Date.now();
    console.log(`Response formatting completed in: ${responseEndTime - responseStartTime}ms`);
    
    const totalTime = Date.now() - startTime;
    console.log(`Total processing time: ${totalTime}ms`);
    if (originalUrl) {
        console.log(`⚡ DISTRIBUTED: Downloaded URL served locally to ML services via HTTP`);
    } else {
        console.log(`⚡ PERFORMANCE: Direct file access eliminates HTTP overhead!`);
    }
    console.log(`Time breakdown:`);
    console.log(`  - ML Services (${serviceCallStrategy}): ${mlDuration}ms`);
    console.log(`  - Result Processing: ${processingEndTime - processingStartTime}ms`);
    console.log(`  - Voting: ${votingEndTime - votingStartTime}ms`);
    console.log(`  - Bounding Boxes: ${bboxEndTime - bboxStartTime}ms`);
    console.log(`  - Caption Processing: ${captionEndTime - captionStartTime}ms`);
    console.log(`  - Response Formatting: ${responseEndTime - responseStartTime}ms`);
    console.log(`  - Unaccounted time: ${totalTime - mlDuration - (processingEndTime - processingStartTime) - (votingEndTime - votingStartTime) - (bboxEndTime - bboxStartTime) - (captionEndTime - captionStartTime) - (responseEndTime - responseStartTime)}ms`);

    return response;
}


// Health check for emoji mappings
app.get('/health/emoji-mappings', async (req, res) => {
    try {
        const filePath = path.join(__dirname, 'emoji_mappings.json');
        const data = await fs.readFile(filePath, 'utf8');
        JSON.parse(data); // Validate JSON
        res.json({ valid: true, status: 'ok' });
    } catch (error) {
        console.error('Emoji mappings validation failed:', error.message);
        res.json({ valid: false, status: 'invalid', error: error.message });
    }
});

// Emoji mappings endpoint with validation
app.get('/emoji_mappings.json', async (req, res) => {
    try {
        const filePath = path.join(__dirname, 'emoji_mappings.json');
        const data = await fs.readFile(filePath, 'utf8');
        JSON.parse(data); // Validate before serving
        res.sendFile(filePath);
    } catch (error) {
        console.error('Error serving emoji mappings:', error.message);
        res.status(500).json({
            success: false,
            error: 'Emoji mappings file is invalid or missing'
        });
    }
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
