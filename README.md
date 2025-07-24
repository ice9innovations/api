# Animal Farm Unified Image Analysis API (v2)

A Node.js REST API that provides comprehensive image analysis using 12 different machine learning services with a sophisticated emoji voting system. This API serves as the single source of truth for Animal Farm's ML capabilities, built on unified v2 service endpoints with standardized response schemas.

## Core Features

### ML Service Integration
- **ML Services**:
   - BLIP (captioning)
   - CLIP (similarity)
   - Colors
   - Detectron2 (object detection
   - Face Detection
   - Inception (classification)
   - LLaMa/LLaVa (language analysis)
   - Metadata extraction (EXIF)
   - NSFW moderation
   - OCR (text detection)
   - YOLO (object detection
   - RT-DETR (object detection)
- **Parallel Processing**: All services execute simultaneously using Node.js concurrency
- **Unified Response Format**: Standardized JSON structure across all services
- **Automatic Confidence Normalization**: All confidence scores normalized to 0-1 scale

### 🚀 Performance Optimizations
- **Dual Analysis Modes**: URL-based analysis for external images, file-path analysis for local images
- **Zero HTTP Overhead**: File-based analysis eliminates network requests between main API and ML services
- **Sub-10ms Overhead**: File analysis reduces total overhead to ~8ms (vs. 120-360ms for URL analysis)
- **Intelligent Image Preprocessing**: Automatic routing to service-specific optimized image variants
- **Service-Specific Sizing**: Each ML service automatically uses its optimal image resolution (384px for BLIP, 640px for YOLO, etc.)
- **COCO Dataset Optimized**: Perfect for high-throughput local image processing with preprocessing support

### Advanced Emoji Voting System
- **Democratic Voting**: Each service gets one vote per emoji (no confidence weighting)
- **Service Deduplication**: Replicates CSS class behavior - each service votes once per emoji maximum
- **Multi-Service Consensus**: Aggregates emoji predictions from all 13 services
- **Tiered Ranking Algorithm**: Promotes emojis based on vote count AND service consensus
- **Service Attribution**: Tracks which specific services voted for each emoji
- **Single-Value Modifiers**: Adds special emojis for face detection (🙂), NSFW content (🔞), and text presence (💬)

### API Capabilities
- **File Upload Support**: Accepts image uploads or direct image URLs
- **Comprehensive Error Handling**: Graceful degradation when individual services fail
- **Real-time Processing**: Sub-second response times with detailed timing information
- **Automatic Cleanup**: Temporary files automatically removed after analysis

## Prerequisites

- Node.js 16+ 
- All Animal Farm ML services running on their respective ports
- At least 4GB RAM recommended for optimal performance

## Installation

```bash
git clone <repository-url>
cd animal-farm-api
npm install
```

## Configuration

1. **Copy the environment template:**
   ```bash
   cp .env.sample .env
   ```

2. **Update service endpoints in `.env`:**
   ```bash
   # Update service hosts/ports to match your ML service deployment
   BLIP_HOST=localhost
   BLIP_PORT=7777
   # ... etc
   ```

## Usage

### Start the API Server

```bash
npm start
```

The API will be available at `http://localhost:8080`

### Health Check

```bash
curl http://localhost:8080/health
```

### Service Status

```bash
curl http://localhost:8080/services/health
```

### Image Analysis

#### 🚀 High-Performance File Analysis (NEW!)
For local images - eliminates HTTP overhead:

```bash
curl "http://localhost:8080/analyze_file?file_path=/path/to/your/image.jpg"
```

#### Analyze Image URL
For external images:

```bash
curl "http://localhost:8080/analyze?url=https://example.com/image.jpg"
```

#### Upload Image File

```bash
curl -X POST http://localhost:8080/analyze \
  -F "image=@/path/to/your/image.jpg"
```

#### Advanced: Analyze Image URL (Legacy POST)

```bash
curl -X POST http://localhost:8080/analyze \
  -H "Content-Type: application/json" \
  -d '{"image_url": "https://example.com/image.jpg"}'
```

## API Endpoints

### GET /analyze_file 🚀 
**NEW!** High-performance file analysis for local images. Eliminates HTTP overhead between main API and ML services.

**Parameters:**
- `file_path` (string): Absolute path to local image file

**Performance Benefits:**
- ⚡ ~8ms total overhead (vs. 120-360ms for URL analysis)
- 🚀 98% reduction in network overhead
- 📁 Perfect for COCO dataset or local image processing

**Example:**
```bash
curl "http://localhost:8080/analyze_file?file_path=/home/user/images/cat.jpg"
```

### GET /analyze
Analyzes external image URLs. Downloads image then processes via ML services.

**Parameters:**
- `url` (string): URL of image to analyze

**Example:**
```bash
curl "http://localhost:8080/analyze?url=https://example.com/image.jpg"
```

### GET /health
Returns server health status and available services.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "services": ["blip", "llama", "clip", "yolo", "detectron", "inception", "colors", "face", "metadata", "nsfw", "ocr", "rtdetr", "rtmdet", "snail"]
}
```

### GET /services/health
Returns the online/offline status of all ML services with detailed systemd information.

**Response:**
```json
{
  "timestamp": "2025-01-01T00:00:00.000Z",
  "services": [
    {
      "service": "blip",
      "status": "online",
      "port": 7777
    },
    {
      "service": "clip",
      "status": "offline",
      "port": 7778,
      "error": "connect ECONNREFUSED"
    }
  ]
}
```

### POST /analyze
Analyzes an image using all 13 ML services and returns aggregated results with emoji voting.

**Request Parameters:**
- `image` (file): Image file upload (multipart/form-data)
- `image_url` (string): URL of image to analyze (JSON)

**Response Structure:**
```json
{
  "success": true,
  "image_id": "uuid-here",
  "analysis_time": 0.536,
  "services_completed": 12,
  "services_failed": 0,
  "emoji_predictions": {
    "final": "😺",
    "second": "🧑", 
    "votes": {
      "😺": 6,
      "🧑": 6,
      "🪑": 4,
      "📚": 2
    },
    "first_place": [
      {
        "emoji": "😺",
        "votes": 6,
        "services": ["BLIP", "CLIP", "YOLO", "Detectron2", "Inception", "RT-DETR"]
      }
    ],
    "second_place": [...],
    "service_attribution": {
      "😺": {
        "count": 6,
        "services": ["BLIP", "CLIP", "YOLO", "Detectron2", "Inception", "RT-DETR"]
      }
    }
  },
  "captions": {
    "blip": "a cat sitting on a wooden table",
    "llama": "A cat on a wooden stool near a bookshelf"
  },
  "caption_scores": {
    "blip": {
      "original": "a cat sitting on a wooden table",
      "raw_score": 2,
      "score": 0.5,
      "matches": 2,
      "words": 4,
      "total_words": 7,
      "formatted": "a <u title=\"😺\">cat</u> 😺 sitting on a wooden <u title=\"🪑\">table</u> 🪑",
      "percentage": 50
    },
    "llama": {
      "original": "A cat on a wooden stool near a bookshelf",
      "raw_score": 1,
      "score": 0.14,
      "matches": 1,
      "words": 7,
      "total_words": 8,
      "formatted": "A <u title=\"😺\">cat</u> 😺 on a wooden <s title=\"🪑\">stool</s> 🪑 near a bookshelf",
      "percentage": 14
    }
  },
  "results": {
    "blip": {...},
    "clip": {...},
    "yolo": {...},
    // ... all 13 services
  }
}
```

**Emoji Voting Algorithm:**
The API implements a sophisticated democratic ranking system with promotion rules:

**Step 1: Vote Collection**
- Each ML service contributes emoji predictions from their analysis
- Services are limited to one vote per emoji (deduplication within each service)
- Single-value modifiers: Face detection adds 🙂, NSFW adds 🔞, text detection adds 💬
- All votes have equal weight regardless of confidence scores

**Step 2: Vote Counting**
- Aggregate votes across all 13 services
- Track service attribution (which services voted for each emoji)
- Sort emojis by total vote count (descending)

**Step 3: Promotion Algorithm**
The democratic promotion rules determine final placement:
- **Position 0**: Always promoted to first place (even with 1 vote)
- **Positions 1-2**: Promoted if ≥2 votes from ≥2 different services
- **Position 2**: Promoted if ≥2 votes from ≥2 different services (same rule as position 1)
- **Positions 3+**: Promoted if ≥3 votes from ≥3 different services
- **All others**: Relegated to second place

**Step 4: Result Structure**
- `first_place`: Array of all emojis that qualified for first place
- `second_place`: Array of emojis that didn't meet promotion criteria
- `final`: Top emoji from first_place array
- `second`: Top emoji from second_place array (or second from first_place if no second_place)

**Key Features:**
- **Service Consensus**: Multiple services agreeing carries more weight than high vote counts from few services
- **Democratic Process**: No single service can dominate results
- **Transparent Attribution**: Full tracking of which services contributed to each emoji
- **Graceful Degradation**: System works even when some services fail
- **Expected Variability**: LLM non-determinism creates natural result variation

**Caption Scoring System:**
The API includes an advanced caption quality assessment system:
- **Word-Emoji Matching**: Analyzes how well caption words align with democratic emoji consensus
- **Scoring Algorithm**: +1 for first-place emoji matches, -1 for second-place matches, -1 for rejected emoji matches
- **Quality Ratio**: Final score = raw_points / meaningful_words (excludes stopwords)
- **Visual Formatting**: Underlined words (first place), italic words (second place), strikethrough words (rejected)
- **Conciseness Reward**: Shorter captions with same point values receive higher scores

## ML Services

The API integrates with the following 13 ML services:

| Service | Port | Purpose | Optimal Size | v2 Endpoints |
|---------|------|---------|--------------|-------------|
| BLIP | 7777 | Image captioning | 384×384 | `/v2/analyze` (URL) + `/v2/analyze_file` (file) |
| Ollama/LLaMa | 7782 | Enhanced image captioning | 512×512 | `/v2/analyze` (URL) + `/v2/analyze_file` (file) |
| CLIP | 7778 | Image classification | 224×224 | `/v2/analyze` (URL) + `/v2/analyze_file` (file) |
| YOLO | 7773 | Object detection | 640×640 | `/v2/analyze` (URL) + `/v2/analyze_file` (file) |
| Detectron2 | 7771 | Instance segmentation | 512×512 | `/v2/analyze` (URL) + `/v2/analyze_file` (file) |
| RT-DETR | 7780 | Real-time object detection | 640×640 | `/v2/analyze` (URL) + `/v2/analyze_file` (file) |
| RTMDet | 7783 | High-performance object detection | 640×640 | `/v2/analyze` (URL) + `/v2/analyze_file` (file) |
| Inception | 7779 | Image classification | 299×299 | `/v2/analyze` (URL) + `/v2/analyze_file` (file) |
| Colors | 7770 | Color palette extraction | 400×400 | `/v2/analyze` (URL) + `/v2/analyze_file` (file) |
| Face | 7772 | Face detection | Original | `/v2/analyze` (URL) + `/v2/analyze_file` (file) |
| NSFW | 7774 | Content safety detection | 480×480 | `/v2/analyze` (URL) + `/v2/analyze_file` (file) |
| OCR | 7775 | Text recognition | 800×800 | `/v2/analyze` (URL) + `/v2/analyze_file` (file) |
| Metadata | 7781 | Image metadata extraction | Original | `/v2/analyze` (URL) + `/v2/analyze_file` (file) |

**Performance Note:** Services automatically route to optimal image variants when available. Console logs indicate when preprocessing optimization is active vs. when performance penalties apply.

## Error Handling

The API provides comprehensive error handling:

- **400 Bad Request**: Invalid file type, missing image, file too large
- **500 Internal Server Error**: Server errors, ML service failures

Example error response:
```json
{
  "success": false,
  "error": "Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed."
}
```

## File Upload Limits

- **Maximum file size**: 10MB
- **Supported formats**: JPEG, PNG, GIF, WebP
- **Automatic cleanup**: Uploaded files are automatically deleted after analysis

## Development

### Run in Development Mode

```bash
npm run dev
```

### Run Tests

```bash
npm test
```

## Architecture

### v2 Unified Design
The API uses a streamlined architecture built on unified service endpoints:

- **V2BaseMLService**: Base class for communicating with all ML services via `/v2/analyze`
- **V2MLService**: Unified service client (replaces 12 individual service classes)
- **V2VotingService**: Simplified emoji aggregation using standardized response format
- **Unified Schema**: All services return consistent JSON structure with normalized confidence scores

### Technology Stack
- **Express.js**: Web framework
- **Multer**: File upload handling
- **Axios**: HTTP client for ML service communication
- **UUID**: Unique identifier generation
- **CORS**: Cross-origin resource sharing

### Migration Benefits
- **Reduced Complexity**: From 12 service-specific parsers to 1 unified processor
- **Improved Consistency**: Standardized confidence scores (0-1 scale) and response formats
- **Enhanced Maintainability**: Adding new services requires minimal code changes
- **Democratic Voting**: Clear, auditable vote counting with service attribution

## Integration

This API is designed to work with the existing Animal Farm ML infrastructure. It requires all ML services to be running on their respective ports for full functionality.

## Troubleshooting

**BEFORE investigating performance issues or service failures:**

1. **Check overall service health:**
   ```bash
   curl -s "http://localhost:8080/health" | jq
   ```

2. **Check detailed service status:**
   ```bash
   curl -s "http://localhost:8080/services/health" | jq
   ```

3. **Look for offline/error services and check systemd status:**
   ```bash
   systemctl status <service-name>-api.service
   ```

4. **Check API logs for service failure warnings:**
   ```bash
   pm2 logs api --lines 50
   ```

**If API responses include `service_health_summary`, services are failing and need investigation.**


## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is part of the Animal Farm ML platform. License details available upon request.

## Support

- **Issues**: Create an issue in this repository
- **Documentation**: See `/docs` directory for detailed technical documentation
- **Health Monitoring**: Use `/health` and `/services/health` endpoints for diagnostics
