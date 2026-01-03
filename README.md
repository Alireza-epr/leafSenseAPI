# LeafSense API

**LeafSense API** is a Node.js/Express backend service to compute **NDVI (Normalized Difference Vegetation Index)** from Sentinel-2 COGs (Cloud Optimized GeoTIFFs). It supports both **point-based** and **zonal-based** NDVI calculations with caching for performance.

---

## **Features**

- Compute NDVI for a single point or a GeoJSON area.
- Returns **mean NDVI**, **median NDVI**, and **validity percentage**.
- Caching mechanism to avoid repeated computations.
- Supports Docker for easy setup and deployment.

---

## **API Endpoints**

### **1. Point NDVI**

**URL:** `/point-ndvi`  
**Method:** `POST`  
**Description:** Computes NDVI for a single latitude/longitude coordinate.  
**Request Body:**

```json
{
  "cog_red": "<URL to Red band COG>",
  "cog_nir": "<URL to NIR band COG>",
  "cog_scl": "<URL to SCL COG>",
  "lat": 40.7128,
  "lon": -74.0060
}
```

### **2. Zonal NDVI**

**URL:** `/zonal-ndvi`  
**Method:** `POST`  
**Description:** Computes NDVI for a GeoJSON area.  
**Request Body:**

```json
{
  "cog_red": "<URL to Red band COG>",
  "cog_nir": "<URL to NIR band COG>",
  "cog_scl": "<URL to SCL COG>",
  "geojson": 
    [
        [-74.006, 40.712],
        [-74.006, 40.713],
        [-74.005, 40.713],
        [-74.005, 40.712],
        [-74.006, 40.712]
    ]
}

```

**Errors:** Returns HTTP 400 with reason field if parameters are missing or invalid.

**Example Response:** 
```json
{
  "meanNDVI": 0.12154701667527358,
  "medianNDVI": 0.10200235247612,
  "validity": "100%",
  "cache": "miss"
}

```

## Installation

### Prerequisites
- Docker Desktop installed (recommended)  
- Node.js (if running locally without Docker)

### Using Docker (Recommended)

1. Clone the repository:

```bash
git clone https://github.com/<your-username>/leafSenseApi.git
cd leafSenseApi
```

2. Build and start the API using Docker Compose:
```bash
docker-compose build
docker-compose up
```

3. API will be available at:
```bash
http://localhost:8000
```