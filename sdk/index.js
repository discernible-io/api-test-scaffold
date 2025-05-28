/**
 * RODiT SDK - Main Entry Point
 * 
 * This SDK provides a client interface for interacting with RODiT authentication and API services.
 * 
 * Copyright (c) 2024 Ayayai, Inc. All rights reserved.
 */

const RoditClient = require('../src/client/roditclient');
const { ensureProtocol } = require('../src/utils');

// Import utility functions
const utils = {
  // Date/time conversion utilities
  unixTimeToDateString: async (unixTime) => {
    // Ensure the timestamp is a number
    const timestamp = Number(unixTime);
    
    if (isNaN(timestamp)) {
      throw new Error('Invalid timestamp format');
    }
    
    // Convert to milliseconds and create Date object
    const date = new Date(timestamp * 1000);
    
    // Format the date string in the expected format: YYYY-MM-DDTHH:MM:SSZ
    const isoString = date.toISOString();
    
    // Return the formatted date string
    return isoString;
  },
  
  dateStringToUnixTime: async (dateString) => {
    // Parse the date string
    const date = new Date(dateString);
    
    // Check if the date is valid
    if (isNaN(date.getTime())) {
      throw new Error('Invalid date string format');
    }
    
    // Convert to Unix timestamp (seconds)
    const unixTime = Math.floor(date.getTime() / 1000);
    
    // Return the Unix timestamp
    return unixTime;
  }
};

// Export the main components
module.exports = {
  RoditClient,
  ensureProtocol,
  utils
};
