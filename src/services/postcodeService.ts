import axios from 'axios';

const POSTCODES_IO_BASE_URL = 'https://api.postcodes.io';

export interface PostcodeValidationResult {
  postcode: string;
  latitude: number;
  longitude: number;
  country: string;
  region: string;
  admin_district: string;
  admin_county: string | null;
  parish: string | null;
  parliamentary_constituency: string;
  european_electoral_region: string;
  ccg: string;
  ced: string | null;
  nuts: string;
  incode: string;
  outcode: string;
  eastings: number;
  northings: number;
}

export interface AddressLookupResult {
  line_1: string;
  line_2?: string;
  line_3?: string;
  post_town: string;
  county?: string;
  postcode: string;
  latitude: number;
  longitude: number;
}

/**
 * Validates and retrieves information for a UK postcode
 * @param postcode - UK postcode to validate
 * @returns PostcodeValidationResult or null if invalid
 */
export async function validatePostcode(postcode: string): Promise<PostcodeValidationResult | null> {
  try {
    const cleanedPostcode = postcode.trim().replace(/\s+/g, '').toUpperCase();
    const response = await axios.get(`${POSTCODES_IO_BASE_URL}/postcodes/${cleanedPostcode}`);
    
    if (response.data.status === 200 && response.data.result) {
      return response.data.result;
    }
    
    return null;
  } catch (error) {
    console.error('Error validating postcode:', error);
    return null;
  }
}

/**
 * Autocomplete postcode suggestions
 * @param partial - Partial postcode string
 * @returns Array of postcode suggestions
 */
export async function autocompletePostcode(partial: string): Promise<string[]> {
  try {
    const cleanedPartial = partial.trim().toUpperCase();
    const response = await axios.get(`${POSTCODES_IO_BASE_URL}/postcodes/${cleanedPartial}/autocomplete`);
    
    if (response.data.status === 200 && response.data.result) {
      return response.data.result;
    }
    
    return [];
  } catch (error) {
    console.error('Error autocompleting postcode:', error);
    return [];
  }
}

/**
 * Find addresses for a given postcode using getAddress.io API
 * Note: Postcodes.io doesn't provide full address lookup, so we'll need to use another service
 * For now, this returns the postcode validation data formatted as an address
 * In production, you might want to integrate with getAddress.io or Royal Mail API
 * 
 * @param postcode - UK postcode
 * @returns Array of addresses
 */
export async function lookupAddresses(postcode: string): Promise<AddressLookupResult[]> {
  try {
    const validationResult = await validatePostcode(postcode);
    
    if (!validationResult) {
      return [];
    }

    // For now, we return a single address based on postcode validation
    // In a production environment, you would integrate with a full address lookup service
    const address: AddressLookupResult = {
      line_1: validationResult.admin_district || validationResult.region,
      post_town: validationResult.admin_district,
      county: validationResult.admin_county || validationResult.region,
      postcode: validationResult.postcode,
      latitude: validationResult.latitude,
      longitude: validationResult.longitude,
    };

    return [address];
  } catch (error) {
    console.error('Error looking up addresses:', error);
    return [];
  }
}

/**
 * Validates multiple postcodes at once
 * @param postcodes - Array of postcodes to validate
 * @returns Array of validation results
 */
export async function validatePostcodes(postcodes: string[]): Promise<(PostcodeValidationResult | null)[]> {
  try {
    const cleanedPostcodes = postcodes.map(p => p.trim().replace(/\s+/g, '').toUpperCase());
    const response = await axios.post(`${POSTCODES_IO_BASE_URL}/postcodes`, {
      postcodes: cleanedPostcodes
    });
    
    if (response.data.status === 200 && response.data.result) {
      return response.data.result.map((item: any) => item.result);
    }
    
    return [];
  } catch (error) {
    console.error('Error validating postcodes:', error);
    return [];
  }
}

/**
 * Get nearest postcodes to given coordinates
 * @param latitude - Latitude
 * @param longitude - Longitude
 * @param limit - Maximum number of results (default: 10)
 * @returns Array of nearby postcodes
 */
export async function getNearestPostcodes(
  latitude: number,
  longitude: number,
  limit: number = 10
): Promise<PostcodeValidationResult[]> {
  try {
    const response = await axios.get(`${POSTCODES_IO_BASE_URL}/postcodes`, {
      params: {
        lat: latitude,
        lon: longitude,
        limit: limit
      }
    });
    
    if (response.data.status === 200 && response.data.result) {
      return response.data.result;
    }
    
    return [];
  } catch (error) {
    console.error('Error getting nearest postcodes:', error);
    return [];
  }
}

/**
 * Reverse geocode - get postcode from coordinates
 * @param latitude - Latitude
 * @param longitude - Longitude
 * @returns PostcodeValidationResult or null
 */
export async function reverseGeocode(latitude: number, longitude: number): Promise<PostcodeValidationResult | null> {
  try {
    const response = await axios.get(`${POSTCODES_IO_BASE_URL}/postcodes`, {
      params: {
        lat: latitude,
        lon: longitude,
        limit: 1
      }
    });
    
    if (response.data.status === 200 && response.data.result && response.data.result.length > 0) {
      return response.data.result[0];
    }
    
    return null;
  } catch (error) {
    console.error('Error reverse geocoding:', error);
    return null;
  }
}

/**
 * Format address components into a full address string
 * @param components - Address components
 * @returns Formatted address string
 */
export function formatAddress(components: {
  line1?: string;
  line2?: string;
  city?: string;
  county?: string;
  postcode?: string;
  country?: string;
}): string {
  const parts = [
    components.line1,
    components.line2,
    components.city,
    components.county,
    components.postcode,
    components.country || 'United Kingdom'
  ].filter(Boolean);

  return parts.join(', ');
}
