import {generateUUID, mergeDeep} from '../../../src/utils.js';
import {bannerResponseProcessor, fillBannerImp} from './banner.js';
import {fillVideoImp, fillVideoResponse} from './video.js';
import {setResponseMediaType} from './mediaType.js';
import {fillNativeImp, fillNativeResponse} from './native.js';
import {BID_RESPONSE, IMP, REQUEST} from '../../../src/pbjsORTB.js';
import {clientSectionChecker} from '../../../src/fpd/oneClient.js';
import { fillAudioImp, fillAudioResponse } from './audio.js';

export const DEFAULT_PROCESSORS = {
  [REQUEST]: {
    fpd: {
      // sets initial request to bidderRequest.ortb2
      priority: 99,
      fn(ortbRequest, bidderRequest) {
        mergeDeep(ortbRequest, bidderRequest.ortb2)
      }
    },
    onlyOneClient: {
      // make sure only one of 'dooh', 'app', 'site' is set in request
      priority: -99,
      fn: clientSectionChecker('ORTB request')
    },
    props: {
      // sets request properties id, tmax, test
      fn(ortbRequest, bidderRequest) {
        Object.assign(ortbRequest, {
          id: ortbRequest.id || generateUUID(),
          test: ortbRequest.test || 0
        });
        const timeout = parseInt(bidderRequest.timeout, 10);
        if (!isNaN(timeout)) {
          ortbRequest.tmax = timeout;
        }
      }
    }
  },
  [IMP]: {
    fpd: {
      // sets initial imp to bidRequest.ortb2Imp
      priority: 99,
      fn(imp, bidRequest) {
        mergeDeep(imp, bidRequest.ortb2Imp);
      }
    },
    id: {
      // sets imp.id
      fn(imp, bidRequest) {
        imp.id = bidRequest.bidId;
      }
    },
    banner: {
      // populates imp.banner
      fn: fillBannerImp
    },
    secure: {
      // should set imp.secure to 1 unless publisher has set it
      fn(imp, bidRequest) {
        imp.secure = imp.secure ?? 1;
      }
    }
  },
  [BID_RESPONSE]: {
    mediaType: {
      // sets bidResponse.mediaType from context.mediaType, falling back to seatbid.bid[].mtype
      priority: 99,
      fn: setResponseMediaType
    },
    banner: {
      // sets banner response attributes if bidResponse.mediaType === BANNER
      fn: bannerResponseProcessor(),
    },
    props: {
      // sets base bidResponse properties common to all types of bids
      fn(bidResponse, bid, context) {
        Object.entries({
          requestId: context.bidRequest?.bidId,
          seatBidId: bid.id,
          cpm: bid.price,
          currency: context.ortbResponse.cur || context.currency,
          width: bid.w,
          height: bid.h,
          wratio: bid.wratio,
          hratio: bid.hratio,
          dealId: bid.dealid,
          creative_id: bid.crid,
          creativeId: bid.crid,
          burl: bid.burl,
          ttl: bid.exp || context.ttl,
          netRevenue: context.netRevenue,
        }).filter(([k, v]) => typeof v !== 'undefined')
          .forEach(([k, v]) => {
            bidResponse[k] = v;
          });
        if (!bidResponse.meta) {
          bidResponse.meta = {};
        }
        if (bid.adomain) {
          bidResponse.meta.advertiserDomains = bid.adomain;
        }
        if (bid.ext?.dsa) {
          bidResponse.meta.dsa = bid.ext.dsa;
        }
        if (bid.cat) {
          bidResponse.meta.primaryCatId = bid.cat[0];
          bidResponse.meta.secondaryCatIds = bid.cat.slice(1);
        }
        if (bid.attr) {
          bidResponse.meta.attr = bid.attr;
        }
        if (bid.ext?.eventtrackers) {
          bidResponse.eventtrackers = (bidResponse.eventtrackers ?? []).concat(bid.ext.eventtrackers);
        }
      }
    }
  }
}

if (FEATURES.NATIVE) {
  DEFAULT_PROCESSORS[IMP].native = {
    // populates imp.native
    fn: fillNativeImp
  }
  DEFAULT_PROCESSORS[BID_RESPONSE].native = {
    // populates bidResponse.native if bidResponse.mediaType === NATIVE
    fn: fillNativeResponse
  }
}

if (FEATURES.VIDEO) {
  DEFAULT_PROCESSORS[IMP].video = {
    // populates imp.video
    fn: fillVideoImp
  }
  DEFAULT_PROCESSORS[BID_RESPONSE].video = {
    // sets video response attributes if bidResponse.mediaType === VIDEO
    fn: fillVideoResponse
  }
}

if (FEATURES.AUDIO) {
  DEFAULT_PROCESSORS[IMP].audio = {
    // populates imp.audio
    fn: fillAudioImp
  }
  DEFAULT_PROCESSORS[BID_RESPONSE].audio = {
    // sets video response attributes if bidResponse.mediaType === AUDIO
    fn: fillAudioResponse
  }
}
