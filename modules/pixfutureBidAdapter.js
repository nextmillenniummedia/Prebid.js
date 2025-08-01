import {registerBidder} from '../src/adapters/bidderFactory.js';
import {getStorageManager} from '../src/storageManager.js';
import {BANNER} from '../src/mediaTypes.js';
import {config} from '../src/config.js';
import {deepAccess, isArray, isNumber, isPlainObject} from '../src/utils.js';
import {auctionManager} from '../src/auctionManager.js';
import {getANKeywordParam} from '../libraries/appnexusUtils/anKeywords.js';
import {convertCamelToUnderscore} from '../libraries/appnexusUtils/anUtils.js';
import {transformSizes} from '../libraries/sizeUtils/tranformSize.js';
import {addUserId, hasUserInfo, getBidFloor} from '../libraries/adrelevantisUtils/bidderUtils.js';

const SOURCE = 'pbjs';
const storageManager = getStorageManager({bidderCode: 'pixfuture'});
const USER_PARAMS = ['age', 'externalUid', 'segments', 'gender', 'dnt', 'language'];
let pixID = '';
const GVLID = 839;

export const spec = {
  code: 'pixfuture',
  gvlid: GVLID,
  hostname: 'https://gosrv.pixfuture.com',

  getHostname() {
    let ret = this.hostname;
    try {
      ret = storageManager.getDataFromLocalStorage('ov_pixbidder_host') || ret;
    } catch (e) {
    }
    return ret;
  },

  isBidRequestValid(bid) {
    return !!(bid.sizes && bid.bidId && bid.params &&
                (bid.params.pix_id && (typeof bid.params.pix_id === 'string')));
  },

  buildRequests(validBidRequests, bidderRequest) {
    const tags = validBidRequests.map(bidToTag);
    const hostname = this.getHostname();
    return validBidRequests.map((bidRequest) => {
      if (bidRequest.params.pix_id) {
        pixID = bidRequest.params.pix_id
      }

      let referer = '';
      if (bidderRequest && bidderRequest.refererInfo) {
        referer = bidderRequest.refererInfo.page || '';
      }

      const userObjBid = ((validBidRequests) || []).find(hasUserInfo);
      let userObj = {};
      if (config.getConfig('coppa') === true) {
        userObj = {'coppa': true};
      }

      if (userObjBid) {
        Object.keys(userObjBid.params.user)
          .filter(param => USER_PARAMS.includes(param))
          .forEach((param) => {
            const uparam = convertCamelToUnderscore(param);
            if (param === 'segments' && isArray(userObjBid.params.user[param])) {
              const segs = [];
              userObjBid.params.user[param].forEach(val => {
                if (isNumber(val)) {
                  segs.push({'id': val});
                } else if (isPlainObject(val)) {
                  segs.push(val);
                }
              });
              userObj[uparam] = segs;
            } else if (param !== 'segments') {
              userObj[uparam] = userObjBid.params.user[param];
            }
          });
      }

      const schain = validBidRequests[0]?.ortb2?.source?.ext?.schain;

      const payload = {
        tags: [...tags],
        user: userObj,
        sdk: {
          source: SOURCE,
          version: '$prebid.version$'
        },
        schain: schain
      };

      if (bidderRequest && bidderRequest.uspConsent) {
        payload.us_privacy = bidderRequest.uspConsent;
      }

      if (bidderRequest && bidderRequest.refererInfo) {
        const refererinfo = {
          // TODO: this collects everything it finds, except for canonicalUrl
          rd_ref: encodeURIComponent(bidderRequest.refererInfo.topmostLocation),
          rd_top: bidderRequest.refererInfo.reachedTop,
          rd_ifs: bidderRequest.refererInfo.numIframes,
          rd_stk: bidderRequest.refererInfo.stack.map((url) => encodeURIComponent(url)).join(',')
        };
        payload.referrer_detection = refererinfo;
      }

      if (validBidRequests[0].userId) {
        const eids = [];

        addUserId(eids, deepAccess(validBidRequests[0], `userId.criteoId`), 'criteo.com', null);
        addUserId(eids, deepAccess(validBidRequests[0], `userId.unifiedId`), 'thetradedesk.com', null);
        addUserId(eids, deepAccess(validBidRequests[0], `userId.id5Id`), 'id5.io', null);
        addUserId(eids, deepAccess(validBidRequests[0], `userId.sharedId`), 'thetradedesk.com', null);
        addUserId(eids, deepAccess(validBidRequests[0], `userId.identityLink`), 'liveramp.com', null);
        addUserId(eids, deepAccess(validBidRequests[0], `userId.liveIntentId`), 'liveintent.com', null);
        addUserId(eids, deepAccess(validBidRequests[0], `userId.fabrickId`), 'home.neustar', null);

        if (eids.length) {
          payload.eids = eids;
        }
      }

      if (tags[0].publisher_id) {
        payload.publisher_id = tags[0].publisher_id;
      }

      const ret = {
        url: `${hostname}/pixservices`,
        method: 'POST',
        options: {withCredentials: true},
        data: {
          v: 'v' + '$prebid.version$',
          pageUrl: referer,
          bidId: bidRequest.bidId,
          // TODO: fix auctionId leak: https://github.com/prebid/Prebid.js/issues/9781
          auctionId: bidRequest.auctionId,
          transactionId: bidRequest.ortb2Imp?.ext?.tid,
          adUnitCode: bidRequest.adUnitCode,
          bidRequestCount: bidRequest.bidRequestCount,
          sizes: bidRequest.sizes,
          params: bidRequest.params,
          pubext: payload
        }
      };
      if (bidderRequest && bidderRequest.gdprConsent) {
        ret.data.gdprConsent = {
          consentString: bidderRequest.gdprConsent.consentString,
          consentRequired: (typeof bidderRequest.gdprConsent.gdprApplies === 'boolean') && bidderRequest.gdprConsent.gdprApplies
        };
      }
      return ret;
    });
  },

  interpretResponse: function (serverResponse, { bidderRequest }) {
    serverResponse = serverResponse.body;
    const bids = [];
    if (serverResponse.creatives.bids && serverResponse.placements) {
      serverResponse.placements.forEach(serverBid => {
        serverBid.creatives.forEach(creative => {
          const bid = newBid(serverBid, creative, serverBid.placement_id, serverBid.uuid);
          bid.mediaType = BANNER;
          bids.push(bid);
        });
      });
    }

    return bids;
  },
  getUserSyncs: function (syncOptions, bid, gdprConsent, uspConsent) {
    const syncs = [];

    let syncurl = 'pixid=' + pixID;
    const gdpr = (gdprConsent && gdprConsent.gdprApplies) ? 1 : 0;
    const consent = gdprConsent ? encodeURIComponent(gdprConsent.consentString || '') : '';

    // Attaching GDPR Consent Params in UserSync url
    syncurl += '&gdprconcent=' + gdpr + '&adsync=' + consent;

    // CCPA
    if (uspConsent) {
      syncurl += '&us_privacy=' + encodeURIComponent(uspConsent);
    }

    // coppa compliance
    if (config.getConfig('coppa') === true) {
      syncurl += '&coppa=1';
    }

    if (syncOptions.iframeEnabled) {
      syncs.push({
        type: 'iframe',
        url: 'https://gosrv.pixfuture.com/cookiesync?f=b&' + syncurl
      });
    } else {
      syncs.push({
        type: 'image',
        url: 'https://gosrv.pixfuture.com/cookiesync?f=i&' + syncurl
      });
    }

    return syncs;
  }
};

function newBid(serverBid, rtbBid, placementId, uuid) {
  const bid = {
    requestId: uuid,
    cpm: rtbBid.cpm,
    creativeId: rtbBid.creative_id,
    currency: 'USD',
    netRevenue: true,
    ttl: 300,
    adUnitCode: placementId
  };

  if (rtbBid.adomain) {
    bid.meta = Object.assign({}, bid.meta, { advertiserDomains: [rtbBid.adomain] });
  };

  Object.assign(bid, {
    width: rtbBid.width,
    height: rtbBid.height,
    ad: rtbBid.code
  });

  return bid;
}

// Functions related optional parameters
function bidToTag(bid) {
  const tag = {};
  tag.sizes = transformSizes(bid.sizes);
  tag.primary_size = tag.sizes[0];
  tag.ad_types = [];
  tag.uuid = bid.bidId;
  if (bid.params.placementId) {
    tag.id = parseInt(bid.params.placementId, 10);
  } else {
    tag.code = bid.params.invCode;
  }
  tag.allow_smaller_sizes = bid.params.allowSmallerSizes || false;
  tag.use_pmt_rule = bid.params.usePaymentRule || false;
  tag.prebid = true;
  tag.disable_psa = true;
  const bidFloor = getBidFloor(bid);
  if (bidFloor) {
    tag.reserve = bidFloor;
  }
  if (bid.params.position) {
    tag.position = {'above': 1, 'below': 2}[bid.params.position] || 0;
  } else {
    const mediaTypePos = deepAccess(bid, `mediaTypes.banner.pos`) || deepAccess(bid, `mediaTypes.video.pos`);
    // only support unknown, atf, and btf values for position at this time
    if (mediaTypePos === 0 || mediaTypePos === 1 || mediaTypePos === 3) {
      // ortb spec treats btf === 3, but our system interprets btf === 2; so converting the ortb value here for consistency
      tag.position = (mediaTypePos === 3) ? 2 : mediaTypePos;
    }
  }
  if (bid.params.trafficSourceCode) {
    tag.traffic_source_code = bid.params.trafficSourceCode;
  }
  if (bid.params.privateSizes) {
    tag.private_sizes = transformSizes(bid.params.privateSizes);
  }
  if (bid.params.supplyType) {
    tag.supply_type = bid.params.supplyType;
  }
  if (bid.params.pubClick) {
    tag.pubclick = bid.params.pubClick;
  }
  if (bid.params.extInvCode) {
    tag.ext_inv_code = bid.params.extInvCode;
  }
  if (bid.params.publisherId) {
    tag.publisher_id = parseInt(bid.params.publisherId, 10);
  }
  if (bid.params.externalImpId) {
    tag.external_imp_id = bid.params.externalImpId;
  }
  tag.keywords = getANKeywordParam(bid.ortb2, bid.params.keywords)

  const gpid = deepAccess(bid, 'ortb2Imp.ext.gpid');
  if (gpid) {
    tag.gpid = gpid;
  }

  if (bid.renderer) {
    tag.video = Object.assign({}, tag.video, {custom_renderer_present: true});
  }

  if (bid.params.frameworks && isArray(bid.params.frameworks)) {
    tag['banner_frameworks'] = bid.params.frameworks;
  }
  // TODO: why does this need to iterate through every adUnit?
  const adUnit = ((auctionManager.getAdUnits()) || []).find(au => bid.transactionId === au.transactionId);
  if (adUnit && adUnit.mediaTypes && adUnit.mediaTypes.banner) {
    tag.ad_types.push(BANNER);
  }

  if (tag.ad_types.length === 0) {
    delete tag.ad_types;
  }

  return tag;
}

registerBidder(spec);
