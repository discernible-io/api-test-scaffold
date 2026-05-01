const crypto = require("crypto");

const FACE_CATEGORIES = [
  {
    name: "overall_structure",
    values: [
      "masculine",
      "feminine",
      "androgynous"
    ]
  },
  {
    name: "face_shape",
    values: [
      "oval-faced",
      "round-faced",
      "square-faced",
      "rectangular-faced",
      "heart-shaped-face",
      "diamond-shaped-face",
      "pear-shaped-face"
    ]
  },
  {
    name: "age_related",
    values: [
      "teenage",
      "young-adult",
      "middle-aged",
      "senior"
    ]
  },
  {
    name: "regional_bone_structure",
    values: [
      "Nordic",
      "Mediterranean",
      "Slavic",
      "East-Asian",
      "Southeast-Asian",
      "South-Asian",
      "West-African",
      "East-African",
      "Native-American",
      "Polynesian",
      "Middle-Eastern",
      "Central-Asian"
    ]
  },
  {
    name: "lips",
    values: [
      "thin-lips",
      "full-lips",
      "bow-shaped-lips",
      "wide-lips",
      "downturned-lips"
    ]
  },
  {
    name: "hair_color",
    values: [
      "black-hair",
      "brown-hair",
      "auburn-hair",
      "red-hair",
      "blonde-hair",
      "gray-hair",
      "white-hair",
      "bald"
    ]
  },
  {
    name: "eyebrow_style",
    values: [
      "thick-eyebrows",
      "thin-eyebrows",
      "arched-eyebrows",
      "straight-eyebrows",
      "unibrow"
    ]
  },
  {
    name: "eyes",
    values: [
      "deep-set-eyes",
      "prominent-eyes",
      "close-set-eyes",
      "wide-set-eyes",
      "almond-shaped-eyes",
      "upturned-eyes",
      "downturned-eyes",
      "monolid-eyes",
      "hooded-eyes",
      "round-eyes"
    ]
  },
  {
    name: "skin_conditions",
    values: [
      "freckled",
      "scarred",
      "wrinkled",
      "clear",
      "pockmarked"
    ]
  },
  {
    name: "skin_tones",
    values: [
      "fair-skinned",
      "golden-skinned",
      "olive-skinned",
      "bronze-skinned",
      "brown-skinned",
      "dark-skinned",
      "ruddy-skinned"
    ]
  },
  {
    name: "nose",
    values: [
      "straight-nose",
      "aquiline-nose",
      "upturned-nose",
      "bulbous-nose",
      "flat-bridged-nose",
      "pinched-nose"
    ]
  }
];

const CHARSET_EVEN = ['b', 'c', 'l', 's', 'z', 'g'];                       // 6 chars - for positions 0,2,4,6,8,10
const CHARSET_ODD = ['d', 'f', 'h', 'j', 'k', 'm', 'n', 'p', 'q', 'r', 't', 'v', 'w', 'x', 'y']; // 15 chars - for positions 1,3,5,7,9,11

// Map each position to its character set
// Even positions use CHARSET_EVEN (6 chars), odd positions use CHARSET_ODD (15 chars)
// Larger categories (more values) are placed in odd positions to utilize CHARSET_ODD's capacity
// This guarantees no consecutive repetitions (adjacent positions always use different sets)
const POSITION_CHARSETS = [
  CHARSET_EVEN, // 0: overall_structure (3 values)
  CHARSET_ODD,  // 1: face_shape (7 values)
  CHARSET_EVEN, // 2: age_related (4 values)
  CHARSET_ODD,  // 3: regional_bone_structure (12 values)
  CHARSET_EVEN, // 4: lips (5 values)
  CHARSET_ODD,  // 5: hair_color (8 values)
  CHARSET_EVEN, // 6: eyebrow_style (5 values)
  CHARSET_ODD,  // 7: eyes (10 values)
  CHARSET_EVEN, // 8: skin_conditions (5 values)
  CHARSET_ODD,  // 9: skin_tones (7 values)
  CHARSET_EVEN, // 10: nose (6 values)
  CHARSET_ODD   // 11: checksum
];

function indexToChar(index, position) {
  const charset = POSITION_CHARSETS[position];
  return charset[index % charset.length];
}

function charToIndex(char, position) {
  const charset = POSITION_CHARSETS[position];
  return charset.indexOf(char);
}

function generateRandomIndex(max) {
  return crypto.randomInt(0, max);
}

function generateRandomFacialTokenId() {
  const indices = FACE_CATEGORIES.map((category) =>
    generateRandomIndex(category.values.length)
  );

  // Map indices to characters using position-specific charsets
  const letterParts = indices.map((idx, pos) => indexToChar(idx, pos));
  
  // Calculate checksum using all indices (position 11 is odd, so uses CHARSET_ODD)
  const checksumIndex = indices.reduce((acc, value) => acc + value, 0) % CHARSET_ODD.length;
  const checksumLetter = CHARSET_ODD[checksumIndex];
  const tokenId = letterParts.join("") + checksumLetter;

  const categories = {};
  FACE_CATEGORIES.forEach((category, idx) => {
    categories[category.name] = {
      index: indices[idx],
      letter: letterParts[idx],
      value: category.values[indices[idx]]
    };
  });

  return {
    tokenId,
    checksum: checksumLetter,
    categories
  };
}

function decodeFacialTokenId(tokenId) {
  // Initial validation: check if tokenId contains only allowed characters from CHARSET_EVEN + CHARSET_ODD
  // CHARSET_EVEN: bclszg, CHARSET_ODD: dfhjkmnpqrtvwxy
  // Note: This does NOT validate position-specific charset rules - that happens later
  const validCharsRegex = /^[bcdfghjklmnpqrstvwxyz]+$/;
  
  if (typeof tokenId !== "string" || tokenId.length !== 12 || !validCharsRegex.test(tokenId)) {
    return {
      tokenId,
      valid: false,
      checksumValid: false,
      reason: "tokenId must be exactly 12 characters from charset (bcdfghjklmnpqrstvwxyz)",
      categories: {}
    };
  }

  const letters = tokenId.split("");
  const indices = [];
  
  // Decode each character using its position-specific charset
  for (let i = 0; i < 11; i += 1) {
    const char = letters[i];
    const idx = charToIndex(char, i);
    
    if (idx === -1) {
      return {
        tokenId,
        valid: false,
        checksumValid: false,
        reason: `Invalid character '${char}' at position ${i}`,
        categories: {}
      };
    }
    
    indices.push(idx);
  }

  // Validate indices are within category bounds
  for (let i = 0; i < FACE_CATEGORIES.length; i += 1) {
    const idx = indices[i];
    const values = FACE_CATEGORIES[i].values;
    if (idx < 0 || idx >= values.length) {
      return {
        tokenId,
        valid: false,
        checksumValid: false,
        reason: `Index ${idx} out of range for category ${FACE_CATEGORIES[i].name} at position ${i}`,
        categories: {}
      };
    }
  }

  // Verify checksum (position 11 is odd, so uses CHARSET_ODD)
  const sumIndices = indices.reduce((acc, v) => acc + v, 0);
  const checksumIndex = sumIndices % CHARSET_ODD.length;
  const expectedChecksumLetter = CHARSET_ODD[checksumIndex];
  const checksumLetter = letters[11];
  const checksumValid = checksumLetter === expectedChecksumLetter;

  const categories = {};
  for (let i = 0; i < FACE_CATEGORIES.length; i += 1) {
    const def = FACE_CATEGORIES[i];
    const idx = indices[i];
    const letter = letters[i];
    categories[def.name] = {
      index: idx,
      letter,
      value: def.values[idx]
    };
  }

  return {
    tokenId,
    valid: checksumValid,
    checksumValid,
    categories
  };
}

module.exports = {
  FACE_CATEGORIES,
  generateRandomFacialTokenId,
  decodeFacialTokenId
};
