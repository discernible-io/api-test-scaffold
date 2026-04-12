const FACE_CATEGORIES = [
  {
    name: "skin_tones",
    values: [
      "pale-skinned",
      "fair-skinned",
      "medium-skinned",
      "tan-skinned",
      "olive-skinned",
      "bronze-skinned",
      "dark-skinned",
      "ebony-skinned",
      "golden-skinned",
      "ivory-skinned",
      "peach-toned-skin",
      "rosy-skinned",
      "ruddy-skinned",
      "sallow-skinned",
      "ashen-skinned",
      "porcelain-skinned",
      "warm-toned-skin",
      "cool-toned-skin",
      "red-toned-skin"
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
      "Celtic-features",
      "Turkish"
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
      "triangular-faced",
      "pear-shaped-face",
      "narrow-faced",
      "wide-faced",
      "angular-faced",
      "curved-faced",
      "asymmetrical-faced",
      "elongated-faced",
      "compact-faced"
    ]
  },
  {
    name: "age_related",
    values: [
      "teenage-person",
      "young-adult-25",
      "middle-aged-50",
      "senior-65",
      "elderly-person"
    ]
  },
  {
    name: "eyes",
    values: [
      "small-eyes",
      "large-eyes",
      "deep-set-eyes",
      "prominent-eyes",
      "close-set-eyes",
      "wide-set-eyes",
      "almond-shaped-eyes",
      "upturned-eyes",
      "downturned-eyes",
      "monolid-eyes"
    ]
  },
  {
    name: "eyebrow_style",
    values: [
      "thick-eyebrows",
      "thin-eyebrows",
      "arched-eyebrows",
      "straight-eyebrows",
      "bushy-eyebrows",
      "sparse-eyebrows"
    ]
  },
  {
    name: "overall_structure",
    values: [
      "masculine",
      "feminine"
    ]
  },
  {
    name: "nose",
    values: [
      "aquiline-nose",
      "button-nose",
      "Roman-nose",
      "snub-nose",
      "flared-nose",
      "pinched-nose"
    ]
  },
  {
    name: "lips",
    values: [
      "thin-lips",
      "full-lips",
      "pouty-lips",
      "defined-lips",
      "bow-shaped-lips"
    ]
  },
  {
    name: "skin_conditions",
    values: [
      "freckled",
      "spotted",
      "scarred",
      "lined",
      "wrinkled",
      "clear"
    ]
  },
  {
    name: "hair_color",
    values: [
      "black-hair",
      "dark-brown-hair",
      "brown-hair",
      "light-brown-hair",
      "blonde-hair",
      "platinum-blonde-hair",
      "red-hair",
      "auburn-hair",
      "gray-hair",
      "white-hair",
      "silver-hair"
    ]
  }
];

function decodeFacialTokenId(tokenId) {
  if (typeof tokenId !== "string" || tokenId.length !== 12 || !/^[a-z]+$/.test(tokenId)) {
    return {
      tokenId,
      valid: false,
      checksumValid: false,
      reason: "tokenId must be exactly 12 lowercase letters a-z",
      categories: {}
    };
  }

  const letters = tokenId.split("");
  const indices = letters.slice(0, 11).map((ch) => ch.charCodeAt(0) - 97);

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

  const sumIndices = indices.reduce((acc, v) => acc + v, 0);
  const checksumIndex = sumIndices % 26;
  const expectedChecksumLetter = String.fromCharCode(97 + checksumIndex);
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
  decodeFacialTokenId
};
