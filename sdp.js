// SDP spec:
//   RFC 4566  https://tools.ietf.org/html/rfc4566

import aac from './aac';
import logger from './logger';

let api = {
  // opts:
  //   username (string): Username or '-'
  //   sessionID (string): Session ID (numeric string)
  //   sessionVersion (string): Session version number
  //   addressType (string): 'IP4' or 'IP6'
  //   unicastAddress (string): Address of the machine from which the session
  //                            was created. A local IP address MUST NOT be
  //                            used in any context where the SDP description
  //                            might leave the scope in which the address is
  //                            meaningful.
  //   hasAudio (boolean): true if the stream contains audio
  //   audioPayloadType (number): payload type for audio
  //   audioEncodingName (string): encoding name for audio
  //   audioClockRate (number): clock rate for audio
  //   audioChannels (number): number of audio channels
  //   audioSampleRate (number): audio sample rate
  //   audioObjectType (number): audio object type
  //   hasVideo (boolean): true if the stream contains video
  //   videoPayloadType (number): payload type for video
  //   videoEncodingName (string): encoding name for video
  //   videoClockRate (number): clock rate for video
  //   videoProfileLevelId (string): profile-level-id for video
  //   videoSpropParameterSets (string): sprop-parameter-sets for video
  //   videoHeight (number): video frame height
  //   videoWidth (number): video frame width
  //   videoFrameRate (string): video frame rate. Either <integer> or
  //                            <integer>.<fraction> is allowed.
  //   durationSeconds (number): duration of the stream in seconds
  createSDP(opts) {
    let fmtp;
    let mandatoryOpts = [
      'username',
      'sessionID',
      'sessionVersion',
      'addressType',
      'unicastAddress'
    ];
    if (opts.hasAudio) {
      mandatoryOpts = mandatoryOpts.concat([
        'audioPayloadType',
        'audioEncodingName',
        'audioClockRate'
      ]);
    }
    if (opts.hasVideo) {
      mandatoryOpts = mandatoryOpts.concat([
        'videoPayloadType',
        'videoEncodingName',
        'videoClockRate'
      ]);
    }
    for (let prop of Array.from(mandatoryOpts)) {
      if (((opts != null ? opts[prop] : undefined) == null)) {
        throw new Error(`createSDP: property ${prop} is required`);
      }
    }

    // SDP parameters are defined in RFC 4566.
    // sizeLength, indexLength, indexDeltaLength are defined by
    // RFC 3640 or RFC 5691.
    //
    // packetization-mode: (see Section 5.4 of RFC 6184 for details)
    //   0: Single NAL Unit Mode
    //   1: Non-Interleaved Mode (for STAP-A, FU-A)
    //   2: Interleaved Mode (for STAP-B, MTAP16, MTAP24, FU-A, FU-B)
    //
    // rtpmap:96 mpeg4-generic/<audio clock rate>/<audio channels>
    //
    // TODO: Use appropriate profile-level-id
    let sdpBody = `\
v=0
o=${opts.username} ${opts.sessionID} ${opts.sessionVersion} IN ${opts.addressType} ${opts.unicastAddress}
s= 
c=IN ${opts.addressType} ${opts.unicastAddress}
t=0 0
a=sdplang:en
a=range:npt=0.0-${opts.durationSeconds != null ? opts.durationSeconds : ''}
a=control:*
\
`;
    if (opts.hasAudio) {
      // configspec: for MPEG-4 Audio streams, use hexstring of AudioSpecificConfig()
      // see 1.6.2.1 of ISO/IEC 14496-3 for the details of AudioSpecificConfig
      let configspec;
      if (opts.audioSpecificConfig != null) {
        configspec = opts.audioSpecificConfig.toString('hex');
      } else if ((opts.audioObjectType != null) && (opts.audioSampleRate != null) && (opts.audioChannels != null)) {
        configspec = new Buffer(aac.createAudioSpecificConfig({
          audioObjectType: opts.audioObjectType,
          samplingFrequency: opts.audioSampleRate,
          channels: opts.audioChannels,
          frameLength: 1024
        })
        );  // TODO: How to detect 960?
        configspec = configspec.toString('hex');
      } else {
        logger.warn("[sdp] warn: audio configspec is not available");
        configspec = null;
      }

      let rtpmap = `${opts.audioPayloadType} ${opts.audioEncodingName}/${opts.audioClockRate}`;
      if (opts.audioChannels != null) {
        rtpmap += `/${opts.audioChannels}`;
      }

      let profileLevelId = 1;  // TODO: Set this value according to audio config
      fmtp = `${opts.audioPayloadType} profile-level-id=${profileLevelId};mode=AAC-hbr;sizeLength=13;indexLength=3;indexDeltaLength=3`;
      if (configspec != null) {
        fmtp += `;config=${configspec}`;
      }

      // profile-level-id=1: Main Profile Level 1
      sdpBody += `\
m=audio 0 RTP/AVP ${opts.audioPayloadType}
a=rtpmap:${rtpmap}
a=fmtp:${fmtp}
a=control:trackID=1
\
`;
    }
    if (opts.hasVideo) {
      fmtp = `${opts.videoPayloadType} packetization-mode=1`;
      if (opts.videoProfileLevelId != null) {
        fmtp += `;profile-level-id=${opts.videoProfileLevelId}`;
      }
      if (opts.videoSpropParameterSets != null) {
        fmtp += `;sprop-parameter-sets=${opts.videoSpropParameterSets}`;
      }
      sdpBody += `\
m=video 0 RTP/AVP ${opts.videoPayloadType}
a=rtpmap:${opts.videoPayloadType} ${opts.videoEncodingName}/${opts.videoClockRate}
a=fmtp:${fmtp}
\
`;
      if ((opts.videoHeight != null) && (opts.videoWidth != null)) {
        sdpBody += `\
a=cliprect:0,0,${opts.videoHeight},${opts.videoWidth}
a=framesize:${opts.videoPayloadType} ${opts.videoWidth}-${opts.videoHeight}
\
`;
      }
      if (opts.videoFrameRate != null) {
        sdpBody += `a=framerate:${opts.videoFrameRate}\n`;
      }
      sdpBody += `\
a=control:trackID=2
\
`;
    }
    return sdpBody.replace(/\n/g, "\r\n");
  },

  // Turn an SDP string like this...
  //
  //   v=0
  //   o=- 0 0 IN IP4 127.0.0.1
  //   s=No Name
  //   c=IN IP4 127.0.0.1
  //   t=0 0
  //   a=tool:libavformat 56.15.102
  //   m=video 0 RTP/AVP 96
  //   b=AS:501
  //   a=rtpmap:96 H264/90000
  //   a=fmtp:96 packetization-mode=1; sprop-parameter-sets=Z0IAFbtA8F/y4CA8IBCo,aM4HDs
  //   g=; profile-level-id=420015
  //   a=control:streamid=0
  //   m=audio 0 RTP/AVP 97
  //   b=AS:125
  //   a=rtpmap:97 MPEG4-GENERIC/44100/2
  //   a=fmtp:97 profile-level-id=1;mode=AAC-hbr;sizelength=13;indexlength=3;indexdelta
  //   length=3; config=1210
  //   a=control:streamid=1
  //
  // ...into an object like this.
  //
  //   { version: '0',
  //     origin:
  //      { username: '-',
  //        sessId: '0',
  //        sessVersion: '0',
  //        nettype: 'IN',
  //        addrtype: 'IP4',
  //        unicastAddress: '127.0.0.1' },
  //     sessionName: 'No Name',
  //     connectionData:
  //      { nettype: 'IN',
  //        addrtype: 'IP4',
  //        connectionAddress: '127.0.0.1' },
  //     timing: { startTime: '0', stopTime: '0' },
  //     attributes: { tool: 'libavformat 56.15.102' },
  //     media:
  //      [ { media: 'video',
  //          port: '0',
  //          proto: 'RTP/AVP',
  //          fmt: 96,
  //          bandwidth: { bwtype: 'AS', bandwidth: '501' },
  //          attributes:
  //           { rtpmap: '96 H264/90000',
  //             fmtp: '96 packetization-mode=1; sprop-parameter-sets=Z0IAFbtA8F/y4CA8IBCo,aM4HDsg=; profile-level-id=420015',
  //             control: 'streamid=0' },
  //          clockRate: 90000,
  //          fmtpParams:
  //           { 'packetization-mode': '1',
  //             'sprop-parameter-sets': 'Z0IAFbtA8F/y4CA8IBCo,aM4HDsg=',
  //             'profile-level-id': '420015' } },
  //        { media: 'audio',
  //          port: '0',
  //          proto: 'RTP/AVP',
  //          fmt: 97,
  //          bandwidth: { bwtype: 'AS', bandwidth: '125' },
  //          attributes:
  //           { rtpmap: '97 MPEG4-GENERIC/44100/2',
  //             fmtp: '97 profile-level-id=1;mode=AAC-hbr;sizelength=13;indexlength=3;indexdeltalength=3; config=1210',
  //             control: 'streamid=1' },
  //          clockRate: 44100,
  //          audioChannels: 2,
  //          fmtpParams:
  //           { 'profile-level-id': '1',
  //             mode: 'AAC-hbr',
  //             sizelength: '13',
  //             indexlength: '3',
  //             indexdeltalength: '3',
  //             config: '1210' } } ] }
  parse(str) {
    let session = {};
    let origParams = [];
    let currentMedia = null;
    for (let line of Array.from(str.split(/\r?\n/))) {
      if (line !== '') {
        var key, match, value;
        if ((match = /^(.*?)=(.*)$/.exec(line)) != null) {
          key = match[1];
          value = match[2];
        } else {
          throw new Error(`Invalid SDP line: ${line}`);
        }
        let obj = {};
        obj[ key ] = value;
        origParams.push(obj);

        switch (key) {
          case 'v':  // Version
            session.version = value;
            break;
          case 'o':  // Origin
            let params = value.split(/\s+/);
            if (params.length > 6) {
              logger.warn(`SDP: Origin has too many parameters: ${line}`);
            }
            session.origin = {
              username: params[0],
              sessId: params[1],
              sessVersion: params[2],
              nettype: params[3],
              addrtype: params[4],
              unicastAddress: params[5]
            };
            break;
          case 's':  // Session Name
            session.sessionName = value;
            break;
          case 'c':  // Connection Data
            params = value.split(/\s+/);
            if (params.length > 3) {
              logger.warn(`SDP: Connection Data has too many parameters: ${line}`);
            }
            session.connectionData = {
              nettype: params[0],
              addrtype: params[1],
              connectionAddress: params[2]
            };
            break;
          case 't':  // Timing
            params = value.split(/\s+/);
            if (params.length > 2) {
              logger.warn(`SDP: Timing has too many parameters: ${line}`);
            }
            session.timing = {
              startTime: params[0],
              stopTime: params[1]
            };
            break;
          case 'a':  // Attributes
            let target = currentMedia != null ? currentMedia : session;
            if ((target.attributes == null)) {
              target.attributes = {};
            }
            if ((match = /^(.*?):(.*)$/.exec(value)) != null) {  // a=<attribute>:<value>
              let attrKey = match[1];
              let attrValue = match[2];
              target.attributes[attrKey] = attrValue;
              if (attrKey === 'rtpmap') {
                if ((match = /\d+\s+.*?\/(\d+)(?:\/(\d+))?/.exec(attrValue)) != null) {
                  target.clockRate = parseInt(match[1]);
                  if (match[2] != null) {
                    target.audioChannels = parseInt(match[2]);
                  }
                }
              } else if (attrKey === 'fmtp') {
                if ((match = /^\d+\s+(.*)$/.exec(attrValue)) != null) {
                  target.fmtpParams = {};
                  for (let pair of Array.from(match[1].split(/;\s*/))) {
                    if ((match = /^(.*?)=(.*)$/.exec(pair)) != null) {
                      target.fmtpParams[ match[1].toLowerCase() ] = match[2];
                    }
                  }
                }
              }
            } else {  // a=<flag>
              target.attributes[ value ] = true;
            }
            break;
          case 'm':  // Media Descriptions
            params = value.split(/\s+/);
            currentMedia = {
              media: params[0],
              port: params[1],
              proto: params[2],
              fmt: params[3]
            };
            if ((currentMedia.proto === 'RTP/AVP') || (currentMedia.proto === 'RTP/SAVP')) {
              currentMedia.fmt = parseInt(currentMedia.fmt);
            }
            if (params.length >= 5) {
              currentMedia.others = params[4];
            }
            if ((session.media == null)) {
              session.media = [];
            }
            session.media.push(currentMedia);
            break;
          case 'b':  // Bandwidth
            params = value.split(':');
            if (params.length > 2) {
              logger.warn(`SDP: Bandwidth has too many parameters: ${line}`);
            }
            target = currentMedia != null ? currentMedia : session;
            target.bandwidth = {
              bwtype: params[0],
              bandwidth: params[1]
            };
            break;
          default:
            logger.warn(`Unknown (not implemented) SDP: ${line}`);
        }
      }
    }

    return session;
  }
};

export default api;