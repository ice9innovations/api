# Animal Farm API Architecture

## Overview
The Animal Farm API serves as a unified interface for 12 different machine learning services, implementing a sophisticated emoji voting system that aggregates predictions across multiple AI models. Features both high-performance file-based analysis for local images and traditional URL-based analysis for external images.

## System Architecture

### High-Performance File Analysis (NEW! 🚀)
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Client App    │    │   Node.js API    │    │  ML Services    │
│                 │    │                  │    │                 │
│ Local File Path │───▶│ GET /analyze_file│───▶│ 12 Services     │
│                 │    │                  │    │ Direct File     │
│ Receive JSON    │◀───│ Voting Algorithm │◀───│ Access (0ms)    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                                      ⚡ 98% faster
```

### Traditional URL Analysis
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Client App    │    │   Node.js API    │    │  ML Services    │
│                 │    │                  │    │                 │
│ External URL    │───▶│ GET /analyze     │───▶│ 12 Services     │
│                 │    │                  │    │ HTTP Requests   │
│ Receive JSON    │◀───│ Voting Algorithm │◀───│ (120-360ms)     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## Core Components

### 1. Express.js Server (`server.js`)
- **File Upload Handling**: Multer-based image upload with validation
- **Parallel Service Execution**: Promise.allSettled for concurrent ML requests
- **Voting Integration**: VotingService processes all results
- **Error Handling**: Graceful degradation when services fail
- **Cleanup**: Automatic temp file removal

### 2. Unified ML Service Client (`V2BaseMLService.js`)
**Unified V2 Architecture** - Single service class handles all ML services:
- **Dual Analysis Modes**: URL analysis (`analyze()`) and file analysis (`analyzeFile()`)
- **REST Compliant**: GET requests instead of POST for read-only operations
- **Zero HTTP Overhead**: File analysis uses direct file paths
- **Unified Response Processing**: All services return standardized v2 response format
- **Retry Logic**: Automatic retries with exponential backoff
- **Timeout Handling**: Configurable timeouts per service
- **Error Normalization**: Consistent error reporting

**Service Architecture:**
```
V2BaseMLService
├── analyze(imageUrl) → GET /v2/analyze?image_url=...
├── analyzeFile(filePath) → GET /v2/analyze_file?file_path=...
├── processImage() → URL-based analysis with HTTP overhead
├── processImageFile() → File-based analysis (zero overhead)
└── processV2Response() → Unified response format handling
```

**Supported Services (12/12):**
- **BLIP** (7777) - Image captioning
- **Ollama/LLaMa** (7782) - LLM-based image analysis  
- **CLIP** (7778) - Image-text similarity
- **YOLO** (7773) - Real-time object detection
- **Detectron2** (7771) - Instance segmentation
- **RT-DETR** (7780) - Real-time transformer detection
- **Inception** (7779) - ImageNet classification
- **Face** (7772) - Face detection and analysis
- **Colors** (7770) - Color palette extraction
- **NSFW** (7774) - Content safety moderation
- **OCR** (7775) - Text extraction
- **Metadata** (7781) - Comprehensive metadata extraction

### 3. Voting System (`VotingService.js`)
Implements the core emoji aggregation algorithm:

#### Data Processing Pipeline:
1. **`buildDataModel()`** - Extract emojis from all service responses
2. **`updatePrediction()`** - Count votes and apply single-value modifiers
3. **`tallyVotes()`** - Track service attribution for each emoji
4. **`finalVoteTally()`** - Apply consensus-based promotion rules

#### Voting Algorithm:
```javascript
// Promotion Rules
if (index === 0) {
    // Top vote always promoted to first place
    firstPlace.push(emoji);
} else if (index <= 2 && votes >= 2 && uniqueServices >= 2) {
    // Positions 1-2: need 2+ votes from 2+ services
    firstPlace.push(emoji);
} else if (index > 2 && votes >= 3 && uniqueServices >= 3) {
    // Positions 3+: need 3+ votes from 3+ services  
    firstPlace.push(emoji);
} else {
    // Everything else goes to second place
    secondPlace.push(emoji);
}
```

#### Single-Value Modifiers:
- **Face Detection**: Adds 🙂 if `faces_detected > 0`
- **NSFW Detection**: Adds 🔞 if `probability > 50%`
- **Text Detection**: Adds 💬 if `has_text === true`

## Data Flow

### 1. Request Processing
```
POST /analyze
├── Multer file upload OR JSON with image_url
├── UUID generation for tracking
├── Image accessibility validation
└── Parallel service execution
```

### 2. ML Service Execution
```
Promise.allSettled([
  blip.analyze(imageUrl),
  clip.analyze(imageUrl),
  yolo.analyze(imageUrl),
  // ... 9 more services
])
```

### 3. Response Aggregation
```
Service Results → VotingService → {
  emoji_predictions: {
    final: "😺",
    votes: {...},
    service_attribution: {...}
  },
  captions: {...},
  results: {...}
}
```

## Configuration

### Environment Variables
- `PORT` - API server port (default: 8080)
- `ML_HOST` - ML services host
- `ML_PROTOCOL` - HTTP/HTTPS protocol
- `ML_TIMEOUT` - Service timeout in ms
- `ML_MAX_RETRIES` - Retry attempts
- `UPLOAD_DIR` - Temporary file directory
- `MAX_FILE_SIZE` - Upload size limit

### Service Configuration (`services/index.js`)
```javascript
const ML_SERVICES_CONFIG = {
  defaults: {
    protocol: process.env.ML_PROTOCOL,
    host: process.env.ML_HOST
  },
  services: {
    blip: { port: 7777, endpoint: '/', param: 'url' },
    clip: { port: 7778, endpoint: '/', param: 'url' },
    // ... all 12 services
  }
};
```

## Error Handling

### Service-Level Resilience
- **Individual Service Failures**: API continues with remaining services
- **Retry Logic**: Exponential backoff with configurable attempts  
- **Timeout Protection**: Per-service timeout limits
- **Error Attribution**: Failed services tracked in response

### Response Guarantees
- **Partial Success**: Returns results even if some services fail
- **Consistent Structure**: Always returns same JSON schema
- **Error Details**: Service failures logged but don't break aggregation

## Performance Characteristics

### Concurrency Model
- **Node.js Event Loop**: Non-blocking I/O for service requests
- **Parallel Execution**: All 12 services called simultaneously
- **No Threading**: Uses async/await with Promise.allSettled

### Typical Performance
- **Response Time**: 0.5-1.0 seconds for all services
- **Bottleneck**: Slowest individual ML service
- **Scalability**: Limited by ML service capacity, not API

## Future Architecture (v2 Endpoints)

### Planned Unified Schema
Each ML service will provide `/v2/analyze` endpoints returning:
```json
{
  "service": "yolo",
  "status": "success", 
  "predictions": [
    {
      "type": "object_detection",
      "label": "cat",
      "emoji": "😺",
      "confidence": 0.95,
      "bbox": {"x": 1, "y": 1, "width": 420, "height": 373}
    }
  ],
  "metadata": {
    "processing_time": 0.234,
    "model_info": {...}
  }
}
```

### Benefits
- **Simplified Parsing**: Consistent structure eliminates service-specific logic
- **Normalized Confidence**: All scores on 0-1 scale
- **Standardized Types**: object_detection, classification, caption, etc.
- **Clean Migration**: v1 endpoints remain for backwards compatibility

This unified API architecture provides a robust, scalable foundation for Animal Farm's machine learning capabilities while maintaining the sophisticated emoji voting system that makes the platform unique.