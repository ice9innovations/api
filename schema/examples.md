# ML Service Response Examples

These examples show how each service type maps to the unified schema.

## Object Detection Services (YOLO, Detectron2, RT-DETR)

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
    },
    {
      "type": "object_detection", 
      "label": "chair",
      "emoji": "🪑",
      "confidence": 0.584,
      "bbox": {"x": 1, "y": 3, "width": 371, "height": 622}
    }
  ],
  "metadata": {
    "processing_time": 0.234,
    "model_info": {
      "name": "YOLOv8",
      "framework": "PyTorch"
    },
    "image_dimensions": {"width": 426, "height": 640},
    "parameters": {
      "confidence_threshold": 0.25,
      "iou_threshold": 0.45
    }
  }
}
```

## Classification Services (CLIP, Inception)

```json
{
  "service": "clip",
  "status": "success", 
  "predictions": [
    {
      "type": "classification",
      "label": "designer",
      "emoji": "🧑",
      "confidence": 0.137
    },
    {
      "type": "classification",
      "label": "cat", 
      "emoji": "😺",
      "confidence": 0.031
    }
  ],
  "metadata": {
    "processing_time": 0.189,
    "model_info": {
      "name": "CLIP",
      "framework": "OpenAI"
    }
  }
}
```

## Captioning Services (BLIP, Ollama)

```json
{
  "service": "blip",
  "status": "success",
  "predictions": [
    {
      "type": "caption",
      "text": "a cat sitting on a wooden table",
      "confidence": 1.0,
      "properties": {
        "emojis": ["😺", "🧑", "🪑"],
        "cleaned_text": "a cat sitting on a wooden table"
      }
    }
  ],
  "metadata": {
    "processing_time": 0.456,
    "model_info": {
      "name": "BLIP",
      "framework": "Salesforce"
    }
  }
}
```

## Color Analysis

```json
{
  "service": "colors",
  "status": "success",
  "predictions": [
    {
      "type": "color_analysis",
      "label": "Warm Gray (W-10)",
      "emoji": "⬛",
      "confidence": 1.0,
      "value": "#2b231f",
      "properties": {
        "rgb": [43, 35, 31],
        "color_system": "Copic",
        "palette": [
          {"hex": "#2f2721", "name": "Warm Gray (W-10)"},
          {"hex": "#7d7c77", "name": "Warm Gray (W-7)"}
        ]
      }
    }
  ],
  "metadata": {
    "processing_time": 0.086,
    "model_info": {
      "framework": "Haishoku + PIL"
    }
  }
}
```

## Face Detection

```json
{
  "service": "face", 
  "status": "success",
  "predictions": [
    {
      "type": "face_detection",
      "label": "face",
      "emoji": "🙂",
      "confidence": 0.95,
      "bbox": {"x": 100, "y": 50, "width": 80, "height": 100},
      "properties": {
        "age": 25,
        "gender": "female",
        "emotion": "happy"
      }
    }
  ],
  "metadata": {
    "processing_time": 0.136,
    "model_info": {
      "name": "SSD MobileNet DNN",
      "framework": "OpenCV"
    },
    "parameters": {
      "detection_method": "ssd_mobilenet_dnn"
    }
  }
}
```

## Content Moderation (NSFW)

```json
{
  "service": "nsfw",
  "status": "success", 
  "predictions": [
    {
      "type": "content_moderation",
      "label": "safe",
      "emoji": "",
      "confidence": 0.948,
      "value": "safe",
      "properties": {
        "probability": 5.2,
        "threshold": 35,
        "is_nsfw": false
      }
    }
  ],
  "metadata": {
    "processing_time": 0.139,
    "model_info": {
      "name": "EfficientNet-v2",
      "framework": "TensorFlow"
    }
  }
}
```

## Text Extraction (OCR)

```json
{
  "service": "ocr",
  "status": "success",
  "predictions": [
    {
      "type": "text_extraction", 
      "text": "Hello World",
      "emoji": "💬",
      "confidence": 0.89,
      "properties": {
        "has_text": true,
        "preprocessing": ["grayscale", "noise_removal", "deskew"]
      }
    }
  ],
  "metadata": {
    "processing_time": 0.112,
    "model_info": {
      "name": "Tesseract OCR",
      "framework": "Tesseract"
    }
  }
}
```

## Metadata Extraction

```json
{
  "service": "metadata",
  "status": "success",
  "predictions": [
    {
      "type": "metadata_extraction",
      "label": "image_metadata",
      "confidence": 1.0,
      "properties": {
        "file_size": 111594,
        "file_type": "JPEG",
        "dimensions": {"width": 426, "height": 640},
        "has_exif": true,
        "has_gps": false,
        "categories": ["camera", "datetime", "image", "software", "technical"]
      }
    }
  ],
  "metadata": {
    "processing_time": 0.06,
    "model_info": {
      "framework": "ExifTool + PIL"
    }
  }
}
```