const prebid = require('../package.json');
const allFeatures = new Set(require('../features.json'));

function featureMap(disable = []) {
  disable = disable.map((s) => s.toUpperCase());
  disable.forEach((f) => {
    if (!allFeatures.has(f)) {
      throw new Error(`Unrecognized feature: ${f}`)
    }
  });
  disable = new Set(disable);
  return Object.fromEntries([...allFeatures.keys()].map((f) => [f, !disable.has(f)]));
}

function skipCallSet(features = {}) {
  const r = new Set();
  if (!features['LOG_NON_ERROR']) {
    r.add('logMessage');
    r.add('logInfo');
    r.add('logWarn');
    r.add('logResult');
  }
  if (!features['LOG_ERROR']) {
    r.add('logError');
  }
  return r;
}

function getNpmVersion(version) {
  try {
    // only use "real" versions (that is, not the -pre ones, they won't be on jsDelivr)
    return /^([\d.]+)$/.exec(version)[1];
  } catch (e) {
    return 'latest';
  }
}

function buildOptions(options) {
  const pbGlobal = options.globalVarName || prebid.globalVarName;
  const defineGlobal = typeof (options.defineGlobal) !== 'undefined' ? options.defineGlobal : prebid.defineGlobal;
  const features = featureMap(options.disableFeatures);
  const skipCalls = skipCallSet(features); // expression calls to skip entirely
  const distUrlBase = options.prebidDistUrlBase || `https://cdn.jsdelivr.net/npm/prebid.js@${getNpmVersion(prebid.version)}/dist/chunks/`;

  return {
    pbGlobal,
    defineGlobal,
    features,
    distUrlBase,
    skipCalls,
  }
}

module.exports = {
  buildOptions
}
