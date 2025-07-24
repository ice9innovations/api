/**
 * Unified V2 ML Service Client
 * Replaces all individual service classes since v2 endpoints have unified response format
 */

const V2BaseMLService = require('./V2BaseMLService');

class V2MLService extends V2BaseMLService {
    constructor(config) {
        super(config);
    }

    // No need to override processV2Response - the base class handles the unified format
    // This class exists mainly for consistency with the existing service pattern
}

module.exports = V2MLService;