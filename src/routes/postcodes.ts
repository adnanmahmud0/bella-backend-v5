import express, { Request, Response } from 'express';
import {
  validatePostcode,
  autocompletePostcode,
  lookupAddresses,
  getNearestPostcodes,
  reverseGeocode,
} from '../services/postcodeService';

const router = express.Router();

/**
 * POST /api/postcodes/validate
 * Validate a UK postcode and get details
 * Body: { postcode: string }
 */
router.post('/validate', async (req: Request, res: Response) => {
  try {
    const { postcode } = req.body;

    if (!postcode || typeof postcode !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Postcode is required',
      });
    }

    const result = await validatePostcode(postcode);

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Invalid postcode or postcode not found',
      });
    }

    res.json({
      success: true,
      data: {
        postcode: result.postcode,
        latitude: result.latitude,
        longitude: result.longitude,
        city: result.admin_district,
        county: result.admin_county || result.region,
        region: result.region,
        country: result.country,
      },
    });
  } catch (error) {
    console.error('Error validating postcode:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to validate postcode',
    });
  }
});

/**
 * GET /api/postcodes/autocomplete?q=SW1A
 * Get postcode autocomplete suggestions
 */
router.get('/autocomplete', async (req: Request, res: Response) => {
  try {
    const { q } = req.query;

    if (!q || typeof q !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Query parameter "q" is required',
      });
    }

    if (q.length < 2) {
      return res.json({
        success: true,
        data: [],
      });
    }

    const suggestions = await autocompletePostcode(q);

    res.json({
      success: true,
      data: suggestions,
    });
  } catch (error) {
    console.error('Error autocompleting postcode:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to autocomplete postcode',
    });
  }
});

/**
 * POST /api/postcodes/lookup
 * Look up addresses for a postcode
 * Body: { postcode: string }
 */
router.post('/lookup', async (req: Request, res: Response) => {
  try {
    const { postcode } = req.body;

    if (!postcode || typeof postcode !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Postcode is required',
      });
    }

    const addresses = await lookupAddresses(postcode);

    if (addresses.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No addresses found for this postcode',
      });
    }

    res.json({
      success: true,
      data: addresses,
    });
  } catch (error) {
    console.error('Error looking up addresses:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to lookup addresses',
    });
  }
});

/**
 * GET /api/postcodes/nearest?lat=51.5074&lon=-0.1278&limit=5
 * Get nearest postcodes to coordinates
 */
router.get('/nearest', async (req: Request, res: Response) => {
  try {
    const { lat, lon, limit } = req.query;

    if (!lat || !lon) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required',
      });
    }

    const latitude = parseFloat(lat as string);
    const longitude = parseFloat(lon as string);
    const maxResults = limit ? parseInt(limit as string) : 10;

    if (isNaN(latitude) || isNaN(longitude)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid latitude or longitude',
      });
    }

    const postcodes = await getNearestPostcodes(latitude, longitude, maxResults);

    res.json({
      success: true,
      data: postcodes.map(p => ({
        postcode: p.postcode,
        latitude: p.latitude,
        longitude: p.longitude,
        city: p.admin_district,
        county: p.admin_county || p.region,
        distance: null, // Distance would need to be calculated
      })),
    });
  } catch (error) {
    console.error('Error getting nearest postcodes:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get nearest postcodes',
    });
  }
});

/**
 * POST /api/postcodes/reverse
 * Reverse geocode coordinates to get postcode
 * Body: { latitude: number, longitude: number }
 */
router.post('/reverse', async (req: Request, res: Response) => {
  try {
    const { latitude, longitude } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required',
      });
    }

    const result = await reverseGeocode(latitude, longitude);

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'No postcode found for these coordinates',
      });
    }

    res.json({
      success: true,
      data: {
        postcode: result.postcode,
        latitude: result.latitude,
        longitude: result.longitude,
        city: result.admin_district,
        county: result.admin_county || result.region,
        region: result.region,
        country: result.country,
      },
    });
  } catch (error) {
    console.error('Error reverse geocoding:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reverse geocode',
    });
  }
});

export default router;
