/* ============================================================================
   FARM KART — shared track geometry module (K3).
   window.FK_TRACK — loaded by BOTH farmkart.html (game) and farmkart-editor.html.
   NO duplicated geometry code: the game and the editor build the ribbon and
   resample the centerline through the SAME functions here.

   Track data format v1 (versioned; K7 adds two OPTIONAL arrays — old saved tracks with
   neither still load unchanged, sanitize tolerates their absence):
     { v:1, name, width, laps,
       points:[{x,z,y}...],        // control points, world meters (already scaled)
       itemRows:[sFraction...],     // DATA ONLY for now (K4 consumes); 0..1 along the lap
       gridSide:"left"|"right",
       wallMargin:Number,           // K7 OPTIONAL grass width beyond the road edge before a firm wall
       boostPads:[{s,lane}...],     // K7 OPTIONAL boost pads: s=0..1 lap fraction, lane=-1..1 across width
       tunnels:[{id,tag,s,len,h,w}...] } // 2026-07-10 OPTIONAL concrete tunnels: s=0..1 start fraction
                                     // (arc-length), len=world-unit span along the centerline,
                                     // h=inner clearance height (default 6), w=inner width (default
                                     // trackWidth+3). Follows the ROAD height, not raw terrain.

   These functions take THREE as a parameter so the module itself has no hard
   dependency (both pages load three.min.js before using FK_TRACK).
   ========================================================================== */
(function(){
  "use strict";

  const SAMPLES = 400;

  // ---- DEFAULT TRACK (the game's original circuit, with its K2 elevations, scale baked in) ----
  // Circuit: long straight -> sweeping 90R -> medium straight -> hairpin 180L on a hill crest
  // -> steep descent -> gentle S chicane -> 180 U-turn back onto the main straight.
  // Coordinates are the original CENTERLINE * 1.5 (TRACK_SCALE), y unchanged.
  const DEFAULT_TRACK = {
    v:1,
    name:"Amen Farms GP",
    width:18,
    laps:3,
    gridSide:"left",
    itemRows:[0.12, 0.40, 0.68],
    points:[
      {x:0,      z:0,      y:0.0},
      {x:0,      z:45,     y:0.6},
      {x:0,      z:90,     y:1.3},
      {x:0,      z:132,    y:2.0},
      {x:-9,     z:150,    y:2.8},
      {x:-27,    z:160.5,  y:3.6},
      {x:-51,    z:165,    y:4.3},
      {x:-87,    z:165,    y:4.9},
      {x:-120,   z:162,    y:5.2},
      {x:-138,   z:154.5,  y:5.4},
      {x:-147,   z:139.5,  y:5.5},
      {x:-141,   z:124.5,  y:5.0},
      {x:-123,   z:120,    y:4.5},
      {x:-96,    z:120,    y:2.0},
      {x:-72,    z:117,    y:0.8},
      {x:-54,    z:105,    y:0.4},
      {x:-39,    z:90,     y:0.1},
      {x:-45,    z:69,     y:0.0},
      {x:-33,    z:51,     y:0.0},
      {x:-36,    z:30,     y:0.0},
      {x:-36,    z:12,     y:0.0},
      {x:-33,    z:-6,     y:0.0},
      {x:-22.5,  z:-16.5,  y:0.0},
      {x:-9,     z:-15,    y:0.0}
    ]
  };

  // ---- BUILT-IN COURSES (converted from real n64decomp/mk64 racing lines; selectable without a save) ----
  // Each course's d_course_<name>_track_path (the CPU racing line, with real elevation) run through
  // tools/mk64-to-farmkart: fixed scale 0.09 (MK64 units->m, calibrated so the road is ~18m),
  // RDP-simplified to ~35-47 control points carrying Y, a curvature guard rounds apexes so the
  // constant-width ribbon can't bowtie, and a bridge pass raises one branch over any flat self-
  // crossing (Choco/Rainbow are real over/unders in the data; Royal/Toad's/Wario are synthesized
  // since track_path omits the bridge height). Keyed by the id used in ?track=<id> and the picker.
  const BUILTIN_TRACKS = {
    "mario-raceway": {
      v:1, name:"Mario Raceway", width:18, laps:3, gridSide:"left", itemRows:[0.12,0.42,0.72],
      points:[{x:0,z:0,y:0},{x:-1,z:32.1,y:0},{x:-6.1,z:45.5,y:0},{x:-18.6,z:53.7,y:0},{x:-52.5,z:64.4,y:0.1},{x:-67.6,z:62.4,y:0.2},{x:-75.3,z:54.5,y:0.5},{x:-77.2,z:42.3,y:1},{x:-75.1,z:25.6,y:2},{x:-81.9,z:8.9,y:3},{x:-124.8,z:-14.4,y:4.4},{x:-147.4,z:-15.8,y:4.1},{x:-162.1,z:-8.1,y:3.5},{x:-182.2,z:12.8,y:2.1},{x:-193.4,z:16.5,y:1.5},{x:-201.2,z:14.5,y:1},{x:-206.5,z:8.6,y:0.7},{x:-208.5,z:-1.9,y:0.4},{x:-204,z:-21.2,y:0.1},{x:-203.4,z:-38.3,y:0},{x:-215.7,z:-64.3,y:0},{x:-214.4,z:-128.6,y:0},{x:-208,z:-147.9,y:0},{x:-194.1,z:-152.3,y:0},{x:-170.3,z:-146.5,y:0},{x:-161.4,z:-138,y:0},{x:-159.9,z:-125.6,y:0},{x:-169.1,z:-101.8,y:0.1},{x:-165.8,z:-87.9,y:0.3},{x:-156.6,z:-79.2,y:0.2},{x:-131.3,z:-75.1,y:-0.7},{x:-45.3,z:-73.5,y:-1.2},{x:-12.8,z:-65.1,y:-0.8},{x:-1.9,z:-46,y:-0.3}]
    },
    "moo-moo-farm": {
      v:1, name:"Moo Moo Farm", width:18, laps:3, gridSide:"left", itemRows:[0.12,0.43,0.64,0.87],
      points:[{x:0,z:0,y:0},{x:3.2,z:97.1,y:-0.4},{x:1.9,z:134.9,y:-1},{x:-1.2,z:150.8,y:-1.5},{x:-11.8,z:167.3,y:-1.4},{x:-29.6,z:182.5,y:-1.6},{x:-52.4,z:193,y:-1.6},{x:-72,z:195,y:-1.3},{x:-83.9,z:192.1,y:-1.3},{x:-96.2,z:184.8,y:-1.3},{x:-118.6,z:164,y:-1.4},{x:-149.2,z:149,y:-1.6},{x:-159.1,z:136.3,y:-1.4},{x:-163.5,z:122.6,y:-1.5},{x:-162.5,z:108.4,y:-1.6},{x:-156.2,z:93.4,y:-1.6},{x:-140.8,z:71.3,y:-1.5},{x:-138.9,z:57.8,y:-1.6},{x:-143.3,z:42.1,y:-1.6},{x:-159.1,z:8.8,y:-1.7},{x:-164.2,z:-18,y:-2.1},{x:-160.9,z:-61.3,y:-1.5},{x:-156.1,z:-80.3,y:-1.3},{x:-147.7,z:-95.2,y:-1.6},{x:-133.3,z:-108.7,y:-1.6},{x:-112.8,z:-119.9,y:-1.5},{x:-98.8,z:-123.3,y:-0.9},{x:-79,z:-123.7,y:-0.4},{x:-63.3,z:-120.3,y:-1.3},{x:-48.7,z:-113.3,y:-1.6},{x:-35.8,z:-103.4,y:-1.3},{x:-23.3,z:-88.1,y:-0.1},{x:-15.4,z:-74,y:-1.2},{x:-4.7,z:-49.1,y:-0.9},{x:-0.4,z:-22.5,y:-0.1}]
    },
    "luigi-raceway": {
      v:1, name:"Luigi Raceway", width:18, laps:3, gridSide:"left", itemRows:[0.15,0.58,0.85],
      points:[{x:0,z:0,y:0},{x:0.8,z:178.2,y:0.2},{x:4.9,z:229.4,y:0.6},{x:13.5,z:249.6,y:1.2},{x:27,z:264,y:1.3},{x:47.4,z:275.1,y:1.3},{x:66.8,z:279.4,y:1.3},{x:88.2,z:277.4,y:1.3},{x:109.4,z:267.7,y:1.3},{x:124.9,z:252.8,y:1.3},{x:134.5,z:235.4,y:1.3},{x:138.4,z:212.5,y:1.3},{x:137.4,z:200,y:1.2},{x:134.5,z:189.5,y:0.8},{x:121.9,z:167.9,y:0.3},{x:105.3,z:154.1,y:-0.1},{x:51.5,z:121.3,y:-1.9},{x:35.6,z:109.4,y:-3},{x:26.3,z:98.5,y:-4.1},{x:20.2,z:87.5,y:-5.8},{x:16.5,z:69.9,y:-9.1},{x:15,z:8.7,y:-11.8},{x:15.9,z:-5.7,y:-10},{x:19.9,z:-18,y:-7.8},{x:35.8,z:-35.9,y:-4.8},{x:87.7,z:-77.7,y:0},{x:101.9,z:-93.9,y:0.3},{x:107.6,z:-107.1,y:0.9},{x:109.4,z:-121.3,y:1.3},{x:106.3,z:-137.2,y:1.3},{x:100.6,z:-148.4,y:1.3},{x:92.6,z:-158.1,y:1.3},{x:82.5,z:-165.6,y:1.3},{x:72.5,z:-169.6,y:1.4},{x:58.3,z:-171.8,y:1.4},{x:44,z:-170.3,y:1.3},{x:32.3,z:-165.7,y:1.3},{x:23.5,z:-159.5,y:1.3},{x:15.2,z:-150,y:1.1},{x:6.7,z:-132.2,y:0.5},{x:1,z:-102.1,y:0},{x:-0.4,z:-71.5,y:0}]
    },
    "kalimari-desert": {
      v:1, name:"Kalimari Desert", width:18, laps:3, gridSide:"left", itemRows:[0.16,0.44,0.79],
      points:[{x:0,z:0,y:0},{x:0.1,z:57.6,y:0.8},{x:2.3,z:82.7,y:1.8},{x:10.1,z:106.6,y:2.1},{x:20.2,z:121.5,y:1.8},{x:31.1,z:130.9,y:0.6},{x:43.8,z:137.5,y:0.6},{x:57.7,z:141.3,y:1.3},{x:70.2,z:142.5,y:1.9},{x:86.4,z:141.2,y:3.1},{x:98.6,z:138.1,y:3.1},{x:111.5,z:131.9,y:2.5},{x:121.5,z:124.1,y:2},{x:131.9,z:111.8,y:1.6},{x:137.5,z:102.5,y:1.5},{x:145.6,z:76.9,y:1},{x:147.9,z:46.4,y:0.3},{x:148.3,z:-49.9,y:1.8},{x:151.5,z:-82,y:1.9},{x:157.5,z:-95.4,y:1.5},{x:175.3,z:-116.5,y:1.2},{x:232.6,z:-176.6,y:0.7},{x:254.4,z:-201.7,y:0.9},{x:264.5,z:-216.9,y:1.4},{x:270.3,z:-235.8,y:2.1},{x:271.1,z:-255.5,y:1.3},{x:265.1,z:-274.2,y:0.5},{x:253.3,z:-290.2,y:0.3},{x:240.7,z:-300.2,y:1},{x:224,z:-306.9,y:0.7},{x:204.4,z:-309.4,y:0.1},{x:179.2,z:-308.7,y:0.3},{x:145.4,z:-303.6,y:0.9},{x:115.7,z:-296.3,y:0.6},{x:99.5,z:-288.4,y:0.1},{x:81.8,z:-273.1,y:0},{x:68.8,z:-253.8,y:0},{x:62.7,z:-238.8,y:0},{x:58.3,z:-221.3,y:0},{x:56.4,z:-194.4,y:0},{x:55.9,z:-133.1,y:0},{x:54.1,z:-113.1,y:-0.3},{x:49.3,z:-100.7,y:-0.7},{x:40.7,z:-89.7,y:-1},{x:18.8,z:-73.2,y:-1.3},{x:8.5,z:-58.6,y:0.1},{x:2.3,z:-36.1,y:0}]
    },
    "koopa-troopa-beach": {
      v:1, name:"Koopa Troopa Beach", width:18, laps:3, gridSide:"left", itemRows:[0.1,0.4,0.62,0.88],
      points:[{x:0,z:0,y:0},{x:-0.4,z:32.3,y:0},{x:-12.4,z:54.9,y:0},{x:-14.9,z:66,y:0},{x:-10.3,z:75.6,y:0},{x:3.7,z:91.3,y:0},{x:21.1,z:122.4,y:0},{x:42.2,z:131.7,y:0},{x:97.5,z:120.3,y:0},{x:123,z:107.6,y:0.2},{x:155.3,z:55.8,y:-0.4},{x:161,z:13.2,y:-0.2},{x:149.2,z:-24.3,y:0},{x:122.1,z:-70.2,y:0},{x:102.2,z:-91.6,y:0},{x:65.8,z:-113.7,y:-0.1},{x:53.1,z:-137.2,y:0},{x:50.2,z:-156.7,y:-0.1},{x:56.7,z:-175.2,y:0},{x:72.8,z:-189.4,y:-0.1},{x:108.2,z:-207,y:0},{x:115.4,z:-221,y:0},{x:113.6,z:-237,y:0},{x:104,z:-247.5,y:0},{x:87.9,z:-255.4,y:0},{x:61.4,z:-260.1,y:0},{x:23.9,z:-256.9,y:0.8},{x:-4.8,z:-242.5,y:0},{x:-14.7,z:-229.8,y:0},{x:-23.2,z:-208.1,y:0},{x:-49.2,z:-186.2,y:0},{x:-59.2,z:-155.5,y:0},{x:-60.6,z:-143,y:0},{x:-55.3,z:-129.7,y:0},{x:-39,z:-112.9,y:-0.4},{x:-6.5,z:-68.1,y:-0.1},{x:0.8,z:-43.4,y:0}]
    },
    "frappe-snowland": {
      v:1, name:"Frappe Snowland", width:18, laps:3, gridSide:"left", itemRows:[0.12,0.41,0.73],
      points:[{x:0,z:0,y:0},{x:-0.6,z:25.1,y:0},{x:-8.7,z:38.1,y:0},{x:-23,z:47,y:0},{x:-57.9,z:59.1,y:0},{x:-69.2,z:70.5,y:0},{x:-74.4,z:83.9,y:0},{x:-73.8,z:103.5,y:0},{x:-59.3,z:132.4,y:0},{x:-53.1,z:169.7,y:0},{x:-47.3,z:182.1,y:0},{x:-38.6,z:187.6,y:0},{x:-27.9,z:187.7,y:0},{x:-18.5,z:182.7,y:0},{x:-11.4,z:172.4,y:0},{x:-5.7,z:151.7,y:0},{x:10.4,z:140.7,y:0},{x:33.9,z:131.9,y:0},{x:62.9,z:135,y:0},{x:85.4,z:120.4,y:-0.1},{x:132.6,z:59.4,y:-0.4},{x:145.9,z:32.2,y:-0.1},{x:139.7,z:9.7,y:0},{x:138.8,z:-15.4,y:0},{x:130.5,z:-44.7,y:0},{x:130.6,z:-87.4,y:0},{x:124.4,z:-103.3,y:0},{x:111.2,z:-110.8,y:0},{x:96.9,z:-110.3,y:0},{x:77,z:-96.8,y:0},{x:66.1,z:-93.7,y:0},{x:55.1,z:-98.8,y:0},{x:40.1,z:-115.1,y:0},{x:22.7,z:-122.3,y:0},{x:-12.8,z:-122.5,y:0},{x:-92.7,z:-133.1,y:0},{x:-116.8,z:-127.7,y:0},{x:-123.8,z:-117.1,y:0},{x:-122.3,z:-105.3,y:0},{x:-115.3,z:-95.2,y:0},{x:-95.9,z:-85.4,y:0},{x:-74.8,z:-84.7,y:0},{x:-33.5,z:-90.6,y:0},{x:-18.1,z:-88.7,y:0},{x:-8.1,z:-80.6,y:0},{x:-1.7,z:-60.4,y:0}]
    },
    "sherbet-land": {
      v:1, name:"Sherbet Land", width:18, laps:3, gridSide:"left", itemRows:[0.11,0.3,0.57,0.83],
      points:[{x:0,z:0,y:0},{x:-2,z:23,y:0},{x:-17.4,z:38.1,y:0},{x:-35,z:52.8,y:0},{x:-35.4,z:68.6,y:0},{x:-15.9,z:95.6,y:0},{x:-1.8,z:126.5,y:0},{x:28.2,z:149,y:0},{x:41.9,z:173.6,y:0},{x:57.1,z:179.3,y:0},{x:76.1,z:166.4,y:0},{x:111.2,z:132.5,y:0},{x:135.1,z:96.7,y:0},{x:152.6,z:84.1,y:0},{x:175.4,z:73.4,y:0},{x:199.3,z:49.1,y:0},{x:211.9,z:25.3,y:0},{x:230.4,z:-31,y:-1.7},{x:241.1,z:-49.8,y:-3.2},{x:266,z:-80.5,y:-6.5},{x:269.9,z:-101.3,y:-7.2},{x:261.3,z:-121,y:-7.2},{x:240.7,z:-146,y:-7.2},{x:226.1,z:-153.6,y:-7.2},{x:209,z:-148,y:-7.2},{x:184.9,z:-124.6,y:-7.2},{x:181.9,z:-109.5,y:-7.2},{x:190.1,z:-97.9,y:-7},{x:212.5,z:-86.3,y:-6.6},{x:220.2,z:-75.2,y:-6},{x:217.7,z:-62,y:-5.2},{x:204.8,z:-47.2,y:-3.5},{x:175,z:-27.1,y:-0.8},{x:155.1,z:-18.6,y:0},{x:135.5,z:-15.7,y:0},{x:116,z:-18.3,y:0},{x:103.1,z:-24.7,y:0},{x:87.1,z:-39.1,y:0},{x:51.9,z:-79.8,y:0},{x:37.8,z:-89.1,y:0},{x:27.3,z:-88.6,y:0},{x:16.6,z:-80.2,y:0},{x:3.3,z:-50.7,y:0},{x:-0.4,z:-29.4,y:0}]
    },
    "choco-mountain": {
      v:1, name:"Choco Mountain", width:18, laps:3, gridSide:"left", itemRows:[0.12,0.43,0.83],
      points:[{x:0,z:0,y:0},{x:-6.2,z:35.6,y:-3.1},{x:-16.2,z:47.7,y:-3.6},{x:-34.5,z:54.4,y:-3.6},{x:-48.6,z:51.7,y:-3.6},{x:-64.8,z:40.1,y:-3.6},{x:-90.7,z:40.5,y:-3.6},{x:-103.8,z:36.8,y:-3.6},{x:-114.2,z:26,y:-3.6},{x:-115.3,z:11.8,y:-3.6},{x:-108.1,z:-2.2,y:-3.6},{x:-84.7,z:-11.3,y:-3.6},{x:-52.6,z:-15.5,y:-5.5},{x:21.2,z:-15.7,y:-8.1},{x:44.2,z:-22.3,y:-6},{x:54,z:-29.2,y:-4.9},{x:66.3,z:-46.1,y:-3.6},{x:67.4,z:-69.8,y:-3.6},{x:55.9,z:-91.2,y:-3.6},{x:48.7,z:-119.2,y:-3.6},{x:18.1,z:-154.3,y:-3.6},{x:-51.8,z:-157,y:-3.6},{x:-101.4,z:-148.9,y:-3.6},{x:-130.9,z:-135.3,y:-3.6},{x:-151.7,z:-121.2,y:-3.6},{x:-166.2,z:-103,y:-3.6},{x:-172.7,z:-84.4,y:-3.6},{x:-170.3,z:-74.1,y:-3.6},{x:-163.1,z:-66.1,y:-3.4},{x:-152.9,z:-62.9,y:-3.2},{x:-142.5,z:-64.7,y:-3.1},{x:-131.8,z:-76.6,y:-2.5},{x:-131.5,z:-110.5,y:-1.4},{x:-120.7,z:-128.7,y:-1},{x:-86.4,z:-144,y:-0.6},{x:-64.9,z:-146,y:-0.1},{x:-49.8,z:-141.6,y:-0.1},{x:-33.9,z:-128.5,y:-0.8},{x:-1.2,z:-89.9,y:-3.4}]
    },
    "dks-jungle-parkway": {
      v:1, name:"DK's Jungle Parkway", width:18, laps:3, gridSide:"left", itemRows:[0.1,0.27,0.52,0.68,0.85],
      points:[{x:0,z:0,y:0},{x:-3.7,z:53.1,y:0},{x:-84.9,z:98.9,y:0},{x:-123.3,z:102.5,y:0.1},{x:-144.3,z:99.4,y:0.3},{x:-153.6,z:99.2,y:0.6},{x:-160.4,z:102.5,y:0.8},{x:-166.1,z:109.5,y:1},{x:-170.9,z:121.7,y:1},{x:-169.4,z:152.5,y:0.2},{x:-132.3,z:174.8,y:-1.2},{x:-65.1,z:173.4,y:-1.3},{x:-46.7,z:190.9,y:-0.4},{x:-40.3,z:224.9,y:0},{x:-20.3,z:236.6,y:0},{x:26.7,z:232.5,y:0},{x:47.2,z:221.7,y:-0.1},{x:52.8,z:198.2,y:0},{x:55.3,z:169.3,y:0},{x:64.8,z:154.6,y:0},{x:81,z:153,y:0},{x:102.5,z:161.8,y:0},{x:121.5,z:169.4,y:0.1},{x:133.5,z:165.2,y:0},{x:144.5,z:149.1,y:-0.1},{x:150.8,z:115.6,y:-3.5},{x:150.3,z:88.6,y:-8.4},{x:141.6,z:67.1,y:-12.3},{x:121.8,z:51.8,y:-14.4},{x:57.1,z:29.1,y:-14.4},{x:34.3,z:12.5,y:-14.4},{x:40.1,z:-10.8,y:-14.3},{x:62.7,z:-49.6,y:-14},{x:64.6,z:-71.5,y:-11.9},{x:44.9,z:-78.7,y:-8.5},{x:14.2,z:-57.5,y:-4.6},{x:1,z:-34.2,y:-1.4}]
    },
    "rainbow-road": {
      v:1, name:"Rainbow Road", width:18, laps:2, gridSide:"left", itemRows:[0.2,0.45,0.64,0.87],
      points:[{x:0,z:0,y:0},{x:-1.3,z:351.8,y:-39.8},{x:-9,z:443.8,y:-46.1},{x:-26.5,z:471.3,y:-46},{x:-58.3,z:482.7,y:-46},{x:-89,z:474,y:-46},{x:-111.3,z:444.2,y:-46},{x:-112.8,z:408.8,y:-46},{x:-77.8,z:355.4,y:-45.5},{x:40.6,z:282.8,y:-54.4},{x:94.3,z:213.6,y:-65.7},{x:140.6,z:61.1,y:-85.7},{x:138.5,z:13,y:-88.5},{x:116.6,z:1.4,y:-86.9},{x:90.7,z:2.4,y:-85.5},{x:70.7,z:22.6,y:-83.9},{x:67.1,z:50.6,y:-82.3},{x:83.4,z:75.6,y:-80.5},{x:114.3,z:83.1,y:-78.6},{x:137.5,z:69.4,y:-77},{x:151.2,z:33.6,y:-75.4},{x:162.5,z:-83,y:-71.5},{x:274.3,z:-177.2,y:-69.4},{x:301.8,z:-217.8,y:-69},{x:290.5,z:-247,y:-69},{x:242.4,z:-248,y:-69},{x:111.1,z:-176.7,y:-69},{x:-96.3,z:-180.1,y:-65.9},{x:-161.7,z:-197.9,y:-64.8},{x:-187.5,z:-234.1,y:-64.7},{x:-186.8,z:-274.9,y:-63.5},{x:-162.9,z:-308,y:-61.9},{x:-131.3,z:-320.3,y:-60.3},{x:-97.6,z:-317.1,y:-58.6},{x:-13.2,z:-253.6,y:-53.7},{x:40.8,z:-243.2,y:-49.9},{x:86.3,z:-274.9,y:-46},{x:84.6,z:-335.5,y:-42.1},{x:55.1,z:-360.8,y:-39.8},{x:19.6,z:-363.9,y:-37.3},{x:-13.1,z:-346.3,y:-33},{x:-29.3,z:-312.6,y:-28.6},{x:-29.9,z:-166.9,y:-12.2}]
    },
    "royal-raceway": {
      v:1, name:"Royal Raceway", width:18, laps:3, gridSide:"left", itemRows:[0.11,0.4,0.76,0.9],
      points:[{x:0,z:0,y:6},{x:1.5,z:112.3,y:8},{x:15.5,z:147.9,y:8.3},{x:68.6,z:185,y:8.3},{x:93.6,z:181.6,y:5.5},{x:105.2,z:161.7,y:3.1},{x:109.7,z:147.9,y:2.2},{x:116,z:139.2,y:1.4},{x:124.7,z:136.2,y:0.8},{x:136.3,z:139.9,y:0.3},{x:154.1,z:156.4,y:0},{x:156.7,z:178.6,y:0},{x:144.2,z:198.2,y:0.3},{x:105.8,z:227.8,y:1.7},{x:84,z:235.5,y:2.3},{x:62.9,z:232.2,y:2.9},{x:18.4,z:202.8,y:2.9},{x:-20.7,z:200.4,y:2.1},{x:-114.3,z:230.4,y:0.4},{x:-142.4,z:221.7,y:0.1},{x:-138.2,z:198.9,y:0},{x:-85.3,z:160.9,y:0},{x:148.5,z:37.2,y:0},{x:199,z:5.4,y:0},{x:209.8,z:-13.2,y:0},{x:205.4,z:-31.5,y:0},{x:164.5,z:-49.6,y:1.3},{x:148,z:-77.7,y:2.4},{x:134.4,z:-85.2,y:2.8},{x:122.3,z:-81.6,y:2.5},{x:109.2,z:-70.1,y:1.2},{x:88.6,z:-63.8,y:0.4},{x:38,z:-72.4,y:0.9},{x:13.9,z:-67.3,y:1.2},{x:0.2,z:-46.8,y:2.6}]
    },
    "toads-turnpike": {
      v:1, name:"Toad's Turnpike", width:18, laps:3, gridSide:"left", itemRows:[0.08,0.42,0.59,0.85],
      points:[{x:0,z:23,y:8},{x:2.4,z:185.4,y:8},{x:9.5,z:226,y:6},{x:26.8,z:253.2,y:2},{x:47.9,z:269.9,y:0},{x:76.5,z:280.4,y:0},{x:110.6,z:282.3,y:0},{x:157.4,z:281.2,y:0},{x:180.1,z:275.9,y:0},{x:209.4,z:258.6,y:0},{x:229.4,z:233.2,y:0},{x:239.7,z:200.7,y:0},{x:237.7,z:166.8,y:0},{x:223.2,z:136,y:0},{x:201.5,z:114.6,y:0},{x:176.8,z:103.4,y:0},{x:99.7,z:98.2,y:0},{x:-160.8,z:97.2,y:0},{x:-244.5,z:93.1,y:0},{x:-277.8,z:80.6,y:0},{x:-300.6,z:57.7,y:0},{x:-312.3,z:31.5,y:0},{x:-314.9,z:1.2,y:0},{x:-310,z:-41.6,y:0},{x:-301.6,z:-59.4,y:0},{x:-289.4,z:-75.1,y:0},{x:-272.6,z:-88.6,y:0},{x:-254.8,z:-97,y:0},{x:-212.1,z:-102.7,y:0},{x:-82.4,z:-101.3,y:0},{x:-51.2,z:-93.3,y:0},{x:-27.6,z:-76.9,y:0},{x:-10.4,z:-54,y:2},{x:-3.5,z:-30.5,y:6}]
    },
    "wario-stadium": {
      v:1, name:"Wario Stadium", width:18, laps:3, gridSide:"left", itemRows:[0.33,0.55,0.68,0.78,0.97],
      points:[{x:0,z:0,y:0},{x:2.8,z:135,y:0},{x:19.8,z:173.5,y:0},{x:69.3,z:192.4,y:0},{x:209.3,z:187,y:0},{x:245.6,z:154.3,y:0},{x:253.8,z:90.5,y:0},{x:246.6,z:63.2,y:0},{x:210.2,z:45.3,y:0},{x:201.3,z:-16,y:0},{x:163.6,z:-17.9,y:0},{x:151.6,z:9.8,y:1.4},{x:161.2,z:67.1,y:0},{x:214.9,z:78,y:0},{x:231.1,z:96.9,y:0},{x:225.5,z:148.1,y:0},{x:193.9,z:169.5,y:0},{x:78.8,z:170.5,y:0},{x:49.2,z:155.7,y:0},{x:37.5,z:117,y:0.1},{x:47.5,z:73.7,y:0.1},{x:61,z:60.9,y:0},{x:75.6,z:59.6,y:0},{x:90.9,z:61.1,y:0},{x:106,z:56,y:0},{x:120.3,z:27.9,y:0},{x:131.1,z:-105.3,y:0},{x:163.2,z:-148.5,y:0},{x:220.6,z:-141.8,y:0},{x:244.3,z:-118.1,y:0},{x:251,z:-82.6,y:2},{x:242.6,z:-62.4,y:6},{x:206.1,z:-53,y:8},{x:93.7,z:-61.4,y:8},{x:60.6,z:-79.3,y:6},{x:46.4,z:-95.4,y:2},{x:39.8,z:-102.1,y:0},{x:33.1,z:-104.3,y:0},{x:25.8,z:-102.7,y:0},{x:17.6,z:-95.8,y:0},{x:7.7,z:-75.8,y:0}]
    },

  };

  // ---- resample: dense 3D Catmull-Rom samples + XZ tangents + arc-length table ----
  // Returns { centerPts:[{x,y,z}], tangents:[{x,z}], arcS:[...], trackLen, samples }.
  // Pure geometry — no TUNE, no ground hills (those stay in the game, TUNE-driven).
  function resample(track, THREE, samples){
    const N = samples || SAMPLES;
    const curve = new THREE.CatmullRomCurve3(
      track.points.map(p => new THREE.Vector3(p.x, p.y||0, p.z)), true, 'catmullrom', 0.5
    );
    const centerPts = [], tangents = [];
    for (let i=0;i<N;i++){
      const t = i/N;
      const p = curve.getPoint(t);
      const tan = curve.getTangent(t);
      const hl = Math.hypot(tan.x, tan.z) || 1;
      centerPts.push({ x:p.x, y:p.y, z:p.z });
      tangents.push({ x:tan.x/hl, z:tan.z/hl });
    }
    const arcS = new Array(N);
    let acc = 0; arcS[0] = 0;
    for (let i=1;i<N;i++){ const a=centerPts[i-1], b=centerPts[i]; acc += Math.hypot(b.x-a.x, b.z-a.z); arcS[i]=acc; }
    const closeSeg = Math.hypot(centerPts[0].x-centerPts[N-1].x, centerPts[0].z-centerPts[N-1].z);
    const trackLen = acc + closeSeg;
    return { centerPts, tangents, arcS, trackLen, samples:N };
  }

  // ---- nearestOnCenter: interpolated on-track height + projected distance (K2.5 STAIRS fix) ----
  // Snapping the on-track height to the NEAREST dense sample's y makes climbs stair-step. Instead:
  // find the nearest sample, then project the query point onto BOTH adjacent centerline segments and
  // lerp y along the closer projection. Returns { idx, dist(projected, in XZ), y(interpolated) }.
  // Lives here so the GAME (sampleHeight) and any future EDITOR height read share one smooth source.
  // refine an anchor sample index bi with adjacent-segment projection -> {idx,dist,y}
  function _refineOnCenter(C, N, bi, x, z){
    let bestY = C[bi].y, bestDist = Math.hypot(x-C[bi].x, z-C[bi].z);
    const segs = [[(bi-1+N)%N, bi], [bi, (bi+1)%N]];
    for (const [i0,i1] of segs){
      const a=C[i0], b=C[i1];
      const abx=b.x-a.x, abz=b.z-a.z;
      const L2 = abx*abx + abz*abz || 1;
      let t = ((x-a.x)*abx + (z-a.z)*abz) / L2;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const px = a.x + abx*t, pz = a.z + abz*t;
      const d = Math.hypot(x-px, z-pz);
      if (d < bestDist){ bestDist = d; bestY = a.y + (b.y-a.y)*t; }
    }
    return { idx:bi, dist:bestDist, y:bestY };
  }
  function nearestOnCenter(sampled, x, z){
    const C = sampled.centerPts, N = sampled.samples;
    let bi = 0, bd = 1e18;
    for (let i=0;i<N;i++){ const c=C[i]; const dx=x-c.x, dz=z-c.z; const d=dx*dx+dz*dz; if(d<bd){bd=d;bi=i;} }
    return _refineOnCenter(C, N, bi, x, z);
  }

  // ---- nearestOnCenterAtY: HEIGHT-AWARE nearest (K7 track-overlap big-jump fix) ----
  // At a self-crossing the two branches are near in XZ but at different elevations; the plain
  // XZ-nearest FLIPS between the low and high road as the kart crosses, so trackY jumps in one
  // frame and the airborne-launch check spikes -> the "big jump". This variant keeps the kart on
  // the LEVEL IT IS ON: it finds the XZ-nearest sample bi, then looks for an ALTERNATE branch far
  // in index but within one road-width in XZ; if that alternate's interpolated y is closer to the
  // seed currentY, it is preferred. On a NON-crossing track no alternate branch is within band, so
  // the result is byte-identical to nearestOnCenter (context-free callers keep plain nearest).
  //   band       = XZ radius (one road-width) within which an alternate branch counts as a crossing
  //   minIdxGap  = index separation that qualifies a sample as a DIFFERENT branch (skips own road)
  function nearestOnCenterAtY(sampled, x, z, currentY, band, minIdxGap){
    const C = sampled.centerPts, N = sampled.samples;
    let bi = 0, bd = 1e18;
    for (let i=0;i<N;i++){ const c=C[i]; const dx=x-c.x, dz=z-c.z; const d=dx*dx+dz*dz; if(d<bd){bd=d;bi=i;} }
    if (currentY == null || !isFinite(currentY)) return _refineOnCenter(C, N, bi, x, z);
    band = (band == null) ? 18 : band;
    const gap = (minIdxGap == null) ? Math.max(8, Math.floor(N*0.06)) : minIdxGap;
    // nearest sample that is a DIFFERENT branch (far enough in index from bi)
    let aj = -1, ad = 1e18;
    for (let i=0;i<N;i++){
      const di = Math.min((i-bi+N)%N, (bi-i+N)%N);
      if (di < gap) continue;
      const c=C[i]; const dx=x-c.x, dz=z-c.z; const d=dx*dx+dz*dz; if(d<ad){ad=d;aj=i;}
    }
    let ci = bi;
    if (aj >= 0 && Math.sqrt(ad) <= band){
      // a genuine overlapping branch is nearby -> prefer whichever level is closest to currentY
      const dyHere = Math.abs(C[bi].y - currentY);
      const dyAlt  = Math.abs(C[aj].y - currentY);
      if (dyAlt + 1e-4 < dyHere) ci = aj;
    }
    return _refineOnCenter(C, N, ci, x, z);
  }

  // ---- buildRibbonGeometry: THREE.Group of asphalt + two curb-stripe ribbons ----
  // Byte-identical to the game's original closedRibbon builder so terrain/feel don't shift.
  // opts (OPTIONAL 4th arg): when opts.followTerrain, EACH ribbon vertex's y is set to
  // groundHills at its OWN XZ (left edge, centerline, right edge independent) so the road drapes
  // over the land AND tilts across its width (natural camber). Absent/false -> byte-identical.
  function buildRibbonGeometry(sampled, width, THREE, opts){
    opts = opts || {};
    const follow = !!opts.followTerrain;
    const centerPts = sampled.centerPts, tangents = sampled.tangents, N = sampled.samples;
    const hw = width/2, curbW = 0.55;
    // Draped roads need extra vertical clearance so the coarser GROUND mesh (which interpolates the
    // same hills over ~4u cells) can't poke through in valleys, and width SUBDIVISION so the surface
    // conforms across the road (a single 18u-wide flat quad cuts through a hill's cross-section).
    const followLift = follow ? 0.22 : 0;
    function closedRibbon(offL, offR, color, layerY, wseg){
      wseg = follow ? (wseg||8) : 1;             // flat = 1 span (byte-identical); draped = subdivided
      const cols = wseg + 1, pos = [];
      for (let i=0;i<N;i++){
        const c = centerPts[i], t = tangents[i];
        const nx = -t.z, nz = t.x; // left normal in XZ
        for (let w=0; w<=wseg; w++){
          const off = offL + (offR-offL)*(w/wseg);
          const x = c.x + nx*off, z = c.z + nz*off;
          // flat: the control-point elevation (unchanged). draped: sample the terrain at THIS vertex's
          // own XZ so the road conforms + cambers, plus followLift so the grass never poke-throughs.
          const y = (follow ? groundHills(x, z, opts) + followLift : c.y) + layerY;
          pos.push(x, y, z);
        }
      }
      const idx = [];
      for (let i=0;i<N;i++){
        const j = (i+1)%N;
        for (let w=0; w<wseg; w++){
          const A=i*cols+w, B=i*cols+w+1, C=j*cols+w, D=j*cols+w+1;
          idx.push(A, B, C); idx.push(B, D, C);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx); g.computeVertexNormals();
      return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, side:THREE.DoubleSide }));
    }
    const grp = new THREE.Group();
    grp.add(closedRibbon(+hw, -hw, 0x33373d, 0.08, 8));                 // road bed — subdivided across width
    grp.add(closedRibbon(+hw, +(hw - curbW), 0xdfe4ea, 0.12, 1));       // curbs are thin -> 1 span is enough
    grp.add(closedRibbon(-(hw - curbW), -hw, 0xdfe4ea, 0.12, 1));
    return grp;
  }

  // ---- sanitize: coerce arbitrary parsed data into a valid track, or null ----
  // Used by the GAME for silent fallback: a corrupt/incomplete save can never brick.
  function sanitize(data){
    try{
      if (!data || typeof data !== 'object') return null;
      if (!Array.isArray(data.points) || data.points.length < 8) return null;
      const points = [];
      for (const p of data.points){
        if (!p || typeof p !== 'object') return null;
        const x = +p.x, z = +p.z, y = (p.y===undefined? 0 : +p.y);
        if (!isFinite(x) || !isFinite(z) || !isFinite(y)) return null;
        points.push({ x, z, y });
      }
      const width = isFinite(+data.width) && +data.width > 0 ? +data.width : 18;
      const laps  = isFinite(+data.laps) && +data.laps >= 1 ? Math.round(+data.laps) : 3;
      let itemRows = [];
      if (Array.isArray(data.itemRows)) itemRows = data.itemRows.map(Number).filter(v=>isFinite(v) && v>=0 && v<=1);
      const gridSide = data.gridSide === 'right' ? 'right' : 'left';
      const name = (typeof data.name === 'string' && data.name.trim()) ? data.name.trim().slice(0,60) : 'Untitled';
      // K7 OPTIONAL: wallMargin (grass beyond the road edge before a firm wall). Absent -> the
      // game falls back to TUNE.wallMargin, so old saved tracks are undisturbed.
      const out = { v:1, name, width, laps, gridSide, itemRows, points };
      if (isFinite(+data.wallMargin) && +data.wallMargin > 0) out.wallMargin = +data.wallMargin;
      // FOLLOW TERRAIN (opt-in per track): the road DRAPES over the procedural hills + sculpt field
      // and tilts with the land, instead of being flat at the authored control-point elevations with
      // the terrain displaced to meet it. Absent/false -> omitted, so every existing track is unchanged.
      // NOTE: this is a SINGLE surface — do not combine with multi-level bridge tracks.
      if (data.followTerrain === true) out.followTerrain = true;
      // WORLD SIZE: how far the grass/terrain mesh extends past the track bbox (editor-tunable). Absent
      // -> buildGroundMesh's default 55. Clamped so a huge value can't blow up the vertex count.
      if (isFinite(+data.groundMargin) && +data.groundMargin > 0) out.groundMargin = Math.min(400, +data.groundMargin);
      // K7 OPTIONAL: boostPads [{s:0..1, lane:-1..1}]. Absent/garbage -> omitted (empty behavior).
      if (Array.isArray(data.boostPads)){
        const pads = [];
        for (const b of data.boostPads){
          if (!b || typeof b !== 'object') continue;
          const s = +b.s, lane = (b.lane===undefined? 0 : +b.lane);
          if (!isFinite(s) || s<0 || s>1 || !isFinite(lane)) continue;
          pads.push({ s, lane:Math.max(-1, Math.min(1, lane)) });
        }
        if (pads.length) out.boostPads = pads;
      }
      // WORLD OBJECTS [{id,tag,type,x,y,z,rotY,sx,sy,sz,color}] — placed massing / blockouts (P2).
      // (x,y,z)=CENTER, (sx,sy,sz)=box dimensions, rotY=yaw. Absent/garbage -> omitted (empty world
      // = the game renders exactly as before). type "block" = a box; future types add real models.
      if (Array.isArray(data.objects)){
        const objs = [];
        for (const o of data.objects){
          if (!o || typeof o !== 'object') continue;
          const x=+o.x, y=+o.y, z=+o.z;
          if (!isFinite(x)||!isFinite(y)||!isFinite(z)) continue;
          const num=(v,d)=> isFinite(+v) ? +v : d;
          const oo = {
            id:   (typeof o.id==='string' && o.id)   ? o.id.slice(0,40) : ('obj_'+(objs.length+1)),
            tag:  (typeof o.tag==='string')          ? o.tag.slice(0,60) : '',
            type: (typeof o.type==='string' && o.type)? o.type.slice(0,24) : 'block',
            x, y, z,
            rotY: num(o.rotY, 0),
            sx: Math.max(0.2, num(o.sx, 6)), sy: Math.max(0.2, num(o.sy, 6)), sz: Math.max(0.2, num(o.sz, 6)),
            color: (typeof o.color==='number') ? o.color : (typeof o.color==='string' ? o.color : 0xc8a06a)
          };
          if (oo.type==='glb' && typeof o.model==='string' && o.model) oo.model = o.model.slice(0,60);  // downloaded prop id
          objs.push(oo);
        }
        if (objs.length) out.objects = objs;
      }
      // TERRAIN SCULPT FIELD (P3): sparse heightfield { cell, cells:{"i,j":delta} }. Absent/empty ->
      // omitted (empty world = the game's terrain is exactly the procedural hills, unchanged).
      if (data.terrain && typeof data.terrain==='object' && data.terrain.cells && typeof data.terrain.cells==='object'){
        const cell = (isFinite(+data.terrain.cell) && +data.terrain.cell > 0) ? +data.terrain.cell : 6;
        const cells = {}; let n = 0;
        for (const k in data.terrain.cells){
          if (!/^-?\d+,-?\d+$/.test(k)) continue;
          const v = +data.terrain.cells[k];
          if (isFinite(v) && Math.abs(v) >= 0.01){ cells[k] = Math.round(v*100)/100; n++; }
        }
        if (n) out.terrain = { cell, cells };
      }
      // TERRAIN PAINT FIELD (P4): sparse color grid { cell, cells:{"i,j":0xRRGGBB} }. Absent/empty ->
      // omitted (unpainted = plain grass mesh, byte-identical).
      if (data.paint && typeof data.paint==='object' && data.paint.cells && typeof data.paint.cells==='object'){
        const cell = (isFinite(+data.paint.cell) && +data.paint.cell > 0) ? +data.paint.cell : 6;
        const cells = {}; let n = 0;
        for (const k in data.paint.cells){
          if (!/^-?\d+,-?\d+$/.test(k)) continue;
          const v = +data.paint.cells[k];
          if (isFinite(v) && v>=0 && v<=0xffffff){ cells[k] = Math.round(v); n++; }
        }
        if (n) out.paint = { cell, cells };
      }
      // FENCES (P5): [{id, tag, points:[{x,z}], height, postGap}]. Absent/garbage -> omitted.
      if (Array.isArray(data.fences)){
        const fences = [];
        for (const f of data.fences){
          if (!f || !Array.isArray(f.points) || f.points.length < 2) continue;
          const pts = [];
          for (const p of f.points){ const x=+p.x, z=+p.z; if (isFinite(x)&&isFinite(z)) pts.push({x,z}); }
          if (pts.length < 2) continue;
          const style = (f.style === 'ribbon') ? 'ribbon' : 'rail';
          fences.push({
            id:  (typeof f.id==='string' && f.id) ? f.id.slice(0,40) : ('fence_'+(fences.length+1)),
            tag: (typeof f.tag==='string') ? f.tag.slice(0,60) : '',
            style,
            points: pts,
            height:  (isFinite(+f.height) && +f.height>0) ? +f.height : (style==='ribbon' ? 1.2 : 2.2),
            postGap: (isFinite(+f.postGap) && +f.postGap>1) ? +f.postGap : 6
          });
        }
        if (fences.length) out.fences = fences;
      }
      // TUNNELS (2026-07-10): [{id,tag,s,len,h,w}] concrete arches over a span of the ROAD. s=0..1
      // start fraction along the centerline arc length, len=world-unit span, h=optional inner
      // clearance height (default 6, applied by buildTunnelMesh), w=optional inner width (default
      // trackWidth+3). Absent/garbage -> omitted (empty world = the game renders exactly as before —
      // re-verified byte-identical for a track without tunnels).
      if (Array.isArray(data.tunnels)){
        const tuns = [];
        for (const tn of data.tunnels){
          if (!tn || typeof tn !== 'object') continue;
          const s = +tn.s, len = +tn.len;
          if (!isFinite(s) || s<0 || s>1 || !isFinite(len) || len<=0) continue;
          const o = {
            id:  (typeof tn.id==='string' && tn.id) ? tn.id.slice(0,40) : ('tunnel_'+(tuns.length+1)),
            tag: (typeof tn.tag==='string') ? tn.tag.slice(0,60) : '',
            s, len: Math.max(4, Math.min(400, len))
          };
          if (isFinite(+tn.h) && +tn.h > 1) o.h = Math.min(40, +tn.h);
          if (isFinite(+tn.w) && +tn.w > 2) o.w = Math.min(200, +tn.w);
          tuns.push(o);
        }
        if (tuns.length) out.tunnels = tuns;
      }
      // BRIDGES (2026-07-10): [{id,tag,s,len,style}] mirrors tunnels exactly — s=0..1 start fraction
      // along the centerline arc length, len=world-unit span. style is a free-form label (default
      // "wood") reserved for future material variants; buildBridgeMesh currently renders one warm-wood
      // look regardless. Absent/garbage -> omitted (empty world = the game renders exactly as before —
      // byte-identical for a track without bridges, same convention as tunnels).
      if (Array.isArray(data.bridges)){
        const brs = [];
        for (const br of data.bridges){
          if (!br || typeof br !== 'object') continue;
          const s = +br.s, len = +br.len;
          if (!isFinite(s) || s<0 || s>1 || !isFinite(len) || len<=0) continue;
          const o = {
            id:  (typeof br.id==='string' && br.id) ? br.id.slice(0,40) : ('bridge_'+(brs.length+1)),
            tag: (typeof br.tag==='string') ? br.tag.slice(0,60) : '',
            s, len: Math.max(4, Math.min(400, len))
          };
          if (typeof br.style === 'string' && br.style) o.style = br.style.slice(0,24);
          brs.push(o);
        }
        if (brs.length) out.bridges = brs;
      }
      return out;
    }catch(e){ return null; }
  }

  // ---- buildObjectMesh: one placed world object -> a THREE.Group at its CENTER, scaled + yaw'd.
  // Shared so the editor and game render identical massing. type "block" = a box; add cases here as
  // real props (barn/house/fence...) get designed. opts.ghost = translucent (editor placeholder look).
  function buildObjectMesh(obj, THREE, opts){
    opts = opts || {};
    const g = new THREE.Group();
    const type = obj.type || 'block';
    const ghost = !!opts.ghost;
    let color = obj.color;
    if (typeof color === 'string') color = parseInt(String(color).replace('#','0x'));
    // All models are authored to fill a UNIT box centered at origin, base at y=-0.5 (so the group's
    // (x,y,z)=CENTER + scale (sx,sy,sz) place/size them uniformly; the gizmo transforms the group).
    const lam = (c, o)=> new THREE.MeshLambertMaterial({ color:c, transparent: ghost || (o!=null && o<1), opacity: (o!=null?o:(ghost?0.5:1)), depthWrite: !(o!=null && o<1) });
    const put = (geo, c, x,y,z, o)=>{ const m=new THREE.Mesh(geo, lam(c,o)); m.position.set(x||0, y||0, z||0); g.add(m); return m; };
    if (type === 'water'){
      const m = put(new THREE.BoxGeometry(1,1,1), isFinite(color)?color:0x2f6fb0, 0,0,0, 0.72); m.renderOrder = 3;
    } else if (type === 'barn'){
      const body = isFinite(color)?color:0xb3402f;
      put(new THREE.BoxGeometry(1,0.6,1), body, 0,-0.2,0);                         // walls  (y -0.5..0.1)
      const rl = put(new THREE.BoxGeometry(0.74,0.05,1.02), 0x7a3b2a, -0.19,0.29,0); rl.rotation.z =  0.72;  // roof L
      const rr = put(new THREE.BoxGeometry(0.74,0.05,1.02), 0x7a3b2a,  0.19,0.29,0); rr.rotation.z = -0.72;  // roof R
      put(new THREE.BoxGeometry(0.28,0.34,0.04), 0xe9e4d8, 0,-0.33,0.5);           // door (front)
    } else if (type === 'silo'){
      put(new THREE.CylinderGeometry(0.42,0.42,0.8,16), isFinite(color)?color:0xc9ccce, 0,-0.1,0);
      put(new THREE.SphereGeometry(0.42,16,8,0,Math.PI*2,0,Math.PI/2), 0xaeb3b6, 0,0.3,0);
    } else if (type === 'tree'){
      put(new THREE.CylinderGeometry(0.09,0.12,0.5,8), 0x6b4a2b, 0,-0.25,0);       // trunk
      put(new THREE.SphereGeometry(0.4,12,10), isFinite(color)?color:0x4f8f3a, 0,0.15,0);   // canopy
    } else if (type === 'ramp'){
      // a jump WEDGE: low edge at -Z (base), rising to full height at +Z. Centered unit box so the
      // group's (x,y,z)=CENTRE + (sx,sy,sz) scale place/size it like every other object; rampSurfaceY
      // (the kart height sampler) uses the SAME geometry so what you see is what you launch off of.
      const col = isFinite(color)?color:0xb8863f;                 // wood/dirt ramp
      const L0=[-.5,-.5,-.5],L1=[.5,-.5,-.5],B0=[-.5,-.5,.5],B1=[.5,-.5,.5],T0=[-.5,.5,.5],T1=[.5,.5,.5];
      const tris=[ [L0,L1,T1],[L0,T1,T0],   // sloped driving surface
                   [L0,B1,B0],[L0,L1,B1],   // flat bottom
                   [B0,B1,T1],[B0,T1,T0],   // vertical back
                   [L0,T0,B0],              // left triangle
                   [L1,B1,T1] ];            // right triangle
      const pos=[]; for (const t of tris) for (const v of t) pos.push(v[0],v[1],v[2]);
      const geo=new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos,3)); geo.computeVertexNormals();
      const m=new THREE.Mesh(geo, lam(col)); m.material.side=THREE.DoubleSide; g.add(m);
    } else if (type === 'glb'){
      // a downloaded CC0 prop, normalized into the unit box at load (opts.propCache[obj.model]).
      const entry = opts.propCache && opts.propCache[obj.model];
      if (entry){
        const clone = entry.scene.clone(true);
        clone.scale.setScalar(entry.norm.s);
        clone.position.set(entry.norm.ox, entry.norm.oy, entry.norm.oz);
        if (ghost) clone.traverse(o=>{ if(o.isMesh && o.material){ o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.6; } });
        g.add(clone);
      } else {
        put(new THREE.BoxGeometry(1,1,1), 0x99a0a8, 0,0,0, 0.4);   // placeholder until the model loads
      }
    } else { // "block" (default) — tagged blockout massing
      if (!isFinite(color)) color = 0xc8a06a;
      put(new THREE.BoxGeometry(1,1,1), color, 0,0,0);
    }
    g.position.set(obj.x, obj.y, obj.z);
    g.scale.set(obj.sx||1, obj.sy||1, obj.sz||1);
    g.rotation.y = obj.rotY || 0;
    g.userData.objId = obj.id;
    return g;
  }

  // ---- buildFenceMesh (P5): a fence polyline -> a barrier that FOLLOWS the terrain.
  // fence = { points:[{x,z}], height, postGap, style }. opts.heightFn(x,z) seats it on the ground
  // (game passes sampleHeight, editor passes its terrain height). Shared so editor + game render
  // identical. style "rail" (default) = wooden posts + 3 rails; style "ribbon" = a solid striped
  // red/white curb-wall (the look of the old auto corridor wall, now a drawable per-stage fence).
  // BOTH styles collide identically in-game (collision reads fence.points via fenceCollide).
  function buildFenceMesh(fence, THREE, opts){
    const g = new THREE.Group();
    const pts = fence.points; if (!pts || pts.length < 2) return g;
    const hfn = (opts && opts.heightFn) || (()=>0);
    const step = 2.5;
    // dense terrain-following path + running arc length (shared by both styles)
    const path = [];
    for (let s=0;s<pts.length-1;s++){
      const a=pts[s], b=pts[s+1], dx=b.x-a.x, dz=b.z-a.z, len=Math.hypot(dx,dz), n=Math.max(1,Math.round(len/step));
      for (let i=0;i<n;i++){ const t=i/n, x=a.x+dx*t, z=a.z+dz*t; path.push({x,z,y:hfn(x,z)}); }
    }
    const last=pts[pts.length-1]; path.push({x:last.x,z:last.z,y:hfn(last.x,last.z)});

    if (fence.style === 'ribbon'){
      // one merged BufferGeometry: a thin vertical wall centred on the polyline, striped by arc length.
      const H = fence.height || 1.2, ht = 0.28, sink = 0.35;   // ht = half thickness (extrude both sides)
      const RED = [0.85,0.16,0.13], WHITE = [0.94,0.94,0.90];
      const positions = [], colors = [];
      const tri = (a,b,c,col)=>{ positions.push(a[0],a[1],a[2], b[0],b[1],b[2], c[0],c[1],c[2]); for(let k=0;k<3;k++) colors.push(col[0],col[1],col[2]); };
      const quad = (p1,p2,p3,p4,col)=>{ tri(p1,p2,p3,col); tri(p1,p3,p4,col); };
      let acc = 0;
      for (let i=0;i<path.length-1;i++){
        const a=path[i], b=path[i+1];
        let nx = -(b.z-a.z), nz = (b.x-a.x); const nl = Math.hypot(nx,nz)||1; nx/=nl; nz/=nl;  // segment normal (XZ)
        const ay = a.y - sink, by = b.y - sink;
        const aLx=a.x+nx*ht, aLz=a.z+nz*ht, aRx=a.x-nx*ht, aRz=a.z-nz*ht;
        const bLx=b.x+nx*ht, bLz=b.z+nz*ht, bRx=b.x-nx*ht, bRz=b.z-nz*ht;
        const col = (Math.floor(acc/2.2)%2===0) ? RED : WHITE;
        quad([aLx,ay,aLz],[aLx,ay+H,aLz],[bLx,by+H,bLz],[bLx,by,bLz], col);   // left face
        quad([bRx,by,bRz],[bRx,by+H,bRz],[aRx,ay+H,aRz],[aRx,ay,aRz], col);   // right face
        quad([aLx,ay+H,aLz],[aRx,ay+H,aRz],[bRx,by+H,bRz],[bLx,by+H,bLz], col); // top cap
        acc += Math.hypot(b.x-a.x, b.z-a.z);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('color',    new THREE.Float32BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      g.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors:true, side:THREE.DoubleSide })));
      return g;
    }

    // default "rail" style — wooden posts + 3 rails
    const H = fence.height || 2.2, postGap = fence.postGap || 6;
    const postMat = new THREE.MeshLambertMaterial({ color:0x6b4a2b });
    const railMat = new THREE.MeshLambertMaterial({ color:0x9a7a4e });
    const railFracs = [0.4, 0.68, 0.95];
    const Z = new THREE.Vector3(0,0,1);
    for (let i=0;i<path.length-1;i++){
      const p=path[i], q=path[i+1];
      for (const f of railFracs){
        const dir = new THREE.Vector3(q.x-p.x, (q.y+H*f)-(p.y+H*f), q.z-p.z); const L=dir.length()||0.01; dir.normalize();
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1,0.13,L), railMat);
        rail.position.set((p.x+q.x)/2, (p.y+q.y)/2 + H*f, (p.z+q.z)/2);
        rail.quaternion.setFromUnitVectors(Z, dir);
        g.add(rail);
      }
    }
    let acc=0, next=0;
    for (let i=0;i<path.length;i++){
      if (i>0) acc += Math.hypot(path[i].x-path[i-1].x, path[i].z-path[i-1].z);
      if (acc>=next || i===path.length-1){ const p=path[i]; const post=new THREE.Mesh(new THREE.BoxGeometry(0.2,H,0.2), postMat); post.position.set(p.x, p.y+H/2, p.z); g.add(post); next+=postGap; }
    }
    return g;
  }

  // ---- buildTunnelMesh (2026-07-10): concrete tunnel arches over a span of the ROAD ----
  // tunnels = ACTIVE_TRACK.tunnels [{s,len,h,w}] (s=0..1 start fraction along the centerline arc
  // length, len=world-unit span, h=inner clearance height default 6, w=inner width default
  // trackWidth+3). Sweeps a rounded concrete-arch profile (open bottom — walls + ceiling only, no
  // floor) along the centerline between s and s+len, seated on opts.heightFn(x,z) (game/editor pass
  // sampleHeight/roadHeightAt so the tunnel follows the SAME y the ribbon uses at that s — NOT raw
  // terrain, matching the fence pattern). Ends flare slightly (portal bulge) so entrances read
  // clearly. Shared by editor + game so both render byte-identical tubes. opts.heightFn absent -> y=0.
  function buildTunnelMesh(sampled, tunnels, trackWidth, THREE, opts){
    const grp = new THREE.Group();
    if (!Array.isArray(tunnels) || !tunnels.length) return grp;
    opts = opts || {};
    const hfn = opts.heightFn || (()=>0);
    // CONCRETE look: the bore's interior faces get no directional light, so a plain MeshLambert
    // falls back to the scene's ambient tint and reads dark olive. Same fix as FK_loadProps
    // ([[gltf-linear-color-gotcha]]): an EMISSIVE lift ≈ base grey × ~0.37 keeps unlit interior
    // faces reading as mid-grey concrete. Diffuse comes from PER-VERTEX colors (material color
    // white) so the portal rings can be shaded a touch darker than the bore for contrast without
    // needing a second material/mesh.
    const mat = new THREE.MeshLambertMaterial({ color:0xffffff, vertexColors:true, emissive:0x3e3e3c, side:THREE.DoubleSide });
    const BASE_R = 0xa8/255, BASE_G = 0xa8/255, BASE_B = 0xa2/255;   // warm light concrete 0xa8a8a2
    const PORTAL_DARKEN = 0.78;                                      // portal ring diffuse multiplier
    const L = sampled.trackLen, arcS = sampled.arcS, C = sampled.centerPts, T = sampled.tangents, N = sampled.samples;
    // interpolated centerline sample at an ABSOLUTE arc-length position (wraps past the lap close).
    function sampleAtArc(a){
      a = a % L; if (a < 0) a += L;
      let i = 0;
      for (; i<N-1; i++){ if (arcS[i+1] > a) break; }
      const i0 = i, i1 = (i+1)%N;
      const segLen = (i1===0) ? (L - arcS[i0]) : (arcS[i1]-arcS[i0]);
      const t = segLen > 1e-6 ? (a-arcS[i0])/segLen : 0;
      const c0=C[i0], c1=C[i1], t0=T[i0], t1=T[i1];
      const x = c0.x+(c1.x-c0.x)*t, z = c0.z+(c1.z-c0.z)*t, y = c0.y+(c1.y-c0.y)*t;
      let tx = t0.x+(t1.x-t0.x)*t, tz = t0.z+(t1.z-t0.z)*t; const tl = Math.hypot(tx,tz)||1;
      return { x, y, z, tx:tx/tl, tz:tz/tl };
    }
    // arch cross-section profile (local u=lateral offset, v=height above the road), open at the
    // bottom: bottom-left -> top of left wall -> rounded arc across the ceiling -> top of right wall
    // -> bottom-right. segs interior arc points -> segs+4 total points (7-9 for the default sizes).
    // 2026-07-11 BURY FIX: the wall legs used to bottom out AT v=0 (road height) — on a sloped or
    // embanked stretch the terrain drops away laterally beside the road while the ring's shared base
    // y stays pinned to the CENTERLINE height (see ringAt below: y = hfn(centerline x,z), same for
    // every column), so the wall base floated above the real ground and showed a gap/seam under the
    // shell. Extending both leg bottoms DOWN by TUNNEL_BURY_DEPTH (fence-post style — buried, not
    // taller) keeps the interior clearance (wallH/arch) untouched while guaranteeing the base always
    // reaches well below anything the terrain does within the tunnel's footprint.
    const TUNNEL_BURY_DEPTH = 2.5;
    function profile(hw, wallH, segs){
      const archR = hw;
      const pts = [[-hw,-TUNNEL_BURY_DEPTH],[-hw,wallH]];
      for (let i=1;i<=segs;i++){
        const a = Math.PI * (1 - i/(segs+1));
        pts.push([archR*Math.cos(a), wallH+archR*Math.sin(a)]);
      }
      pts.push([hw,wallH],[hw,-TUNNEL_BURY_DEPTH]);
      return pts;
    }
    for (const tn of tunnels){
      const startArc = Math.max(0, Math.min(1, tn.s)) * L;
      const len = Math.max(4, tn.len || 18);
      const h = (isFinite(tn.h) && tn.h > 1) ? tn.h : 6;
      const w = (isFinite(tn.w) && tn.w > 2) ? tn.w : (trackWidth + 3);
      const hw = w/2;
      const wallH = Math.max(0.5, h - hw);
      const prof = profile(hw, wallH, 5);
      const cols = prof.length;
      const step = 2.5, steps = Math.max(2, Math.ceil(len/step));
      const portalDepth = Math.min(2.5, len*0.3), portalBulge = 0.16;
      function ringAt(a){
        const p = sampleAtArc(a);
        const y = hfn(p.x, p.z);
        const nx = -p.tz, nz = p.tx;
        const distFromStart = a - startArc, distFromEnd = (startArc+len) - a;
        const nearEnd = Math.max(0, Math.min(distFromStart, distFromEnd));
        const bulge = portalDepth > 0.01 ? (1 - Math.min(1, nearEnd/portalDepth)) : 0;
        const scale = 1 + portalBulge*bulge;
        const ring = new Array(cols);
        for (let k=0;k<cols;k++){
          const u = prof[k][0]*scale, v = prof[k][1]*scale;
          ring[k] = [ p.x + nx*u, y + v, p.z + nz*u ];
        }
        ring.bulge = bulge;   // portal shading factor for this ring (0 = bore, 1 = portal lip)
        return ring;
      }
      const positions = [], colors = [];
      // per-vertex concrete tint: bore = base grey, portal rings darkened for contrast.
      const shadeOf = (ring)=>{ const m = 1 - (1-PORTAL_DARKEN)*ring.bulge; return [BASE_R*m, BASE_G*m, BASE_B*m]; };
      const pushV = (v, c)=>{ positions.push(v[0],v[1],v[2]); colors.push(c[0],c[1],c[2]); };
      let prevRing = ringAt(startArc);
      for (let s=1; s<=steps; s++){
        const ring = ringAt(startArc + len*(s/steps));
        const cPrev = shadeOf(prevRing), cRing = shadeOf(ring);
        for (let k=0;k<cols-1;k++){
          const A=prevRing[k], B=prevRing[k+1], Cc=ring[k], D=ring[k+1];
          pushV(A,cPrev); pushV(B,cPrev); pushV(Cc,cRing);
          pushV(B,cPrev); pushV(D,cRing); pushV(Cc,cRing);
        }
        prevRing = ring;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('color',    new THREE.Float32BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.tunnelId = tn.id;
      grp.add(mesh);
    }
    return grp;
  }

  // ---- buildBridgeMesh (2026-07-10): a wooden bridge over a span of the ROAD ----
  // Mirrors buildTunnelMesh's architecture exactly: bridges = ACTIVE_TRACK.bridges [{s,len,style}]
  // (s=0..1 start fraction along the centerline arc length, len=world-unit span). Seated on the ROAD
  // height (opts.heightFn — same seat convention as tunnels, NOT raw terrain) so the deck follows the
  // road exactly. Renders side rails (posts + two horizontal rails each side, same construction as
  // buildFenceMesh's "rail" style), a slight raised deck lip along both road edges, and vertical
  // SUPPORT PILLARS at ~6u intervals from the road underside down to opts.groundFn(x,z) — the terrain
  // height WITHOUT road influence (the game/editor pass groundSampleHeight, which stays on the lowest
  // branch under a true multi-level overlap — exactly the classic use case: the raised half of a
  // figure-8). Pillars are skipped where the gap is under ~1.5u (an at-grade span needs no support).
  // Warm wood-brown materials with an emissive lift (house convention, see buildTunnelMesh/
  // [[gltf-linear-color-gotcha]]) so the undersides don't render flat black. Purely visual — no
  // collision/physics change (matches tunnels). opts.heightFn/groundFn absent -> y=0.
  function buildBridgeMesh(sampled, bridges, trackWidth, THREE, opts){
    const grp = new THREE.Group();
    if (!Array.isArray(bridges) || !bridges.length) return grp;
    opts = opts || {};
    const hfn = opts.heightFn || (()=>0);
    const gfn = opts.groundFn || hfn;
    const L = sampled.trackLen, arcS = sampled.arcS, C = sampled.centerPts, T = sampled.tangents, N = sampled.samples;
    function sampleAtArc(a){
      a = a % L; if (a < 0) a += L;
      let i = 0;
      for (; i<N-1; i++){ if (arcS[i+1] > a) break; }
      const i0 = i, i1 = (i+1)%N;
      const segLen = (i1===0) ? (L - arcS[i0]) : (arcS[i1]-arcS[i0]);
      const t = segLen > 1e-6 ? (a-arcS[i0])/segLen : 0;
      const c0=C[i0], c1=C[i1], t0=T[i0], t1=T[i1];
      const x = c0.x+(c1.x-c0.x)*t, z = c0.z+(c1.z-c0.z)*t, y = c0.y+(c1.y-c0.y)*t;
      let tx = t0.x+(t1.x-t0.x)*t, tz = t0.z+(t1.z-t0.z)*t; const tl = Math.hypot(tx,tz)||1;
      return { x, y, z, tx:tx/tl, tz:tz/tl };
    }
    const postMat   = new THREE.MeshLambertMaterial({ color:0x5a3d24, emissive:0x241708 });
    const railMat   = new THREE.MeshLambertMaterial({ color:0x8a6239, emissive:0x362717 });
    const lipMat    = new THREE.MeshLambertMaterial({ color:0x9a7245, emissive:0x3c2d1a });
    const pillarMat = new THREE.MeshLambertMaterial({ color:0x6b4a2e, emissive:0x2a1d12 });
    const Z = new THREE.Vector3(0,0,1);
    const RAIL_FRACS = [0.42, 0.9], RAIL_H = 1.35;
    const POST_GAP = 6, PILLAR_GAP = 6, MIN_PILLAR_GAP_Y = 1.5, PILLAR_FOOT = 0.6, DECK_THICK = 0.3;
    for (const br of bridges){
      const startArc = Math.max(0, Math.min(1, br.s)) * L;
      const len = Math.max(4, br.len || 18);
      const hw = trackWidth/2;
      const step = 2.0, steps = Math.max(2, Math.ceil(len/step));
      const path = [];
      for (let s=0;s<=steps;s++){
        const a = startArc + len*(s/steps);
        const p = sampleAtArc(a);
        const y = hfn(p.x, p.z);
        const nx = -p.tz, nz = p.tx;
        path.push({ x:p.x, y, z:p.z, nx, nz });
      }
      // deck lip: a thin raised strip along each road edge
      for (const side of [1,-1]){
        for (let i=0;i<path.length-1;i++){
          const a=path[i], b=path[i+1];
          const ax=a.x+a.nx*hw*side, az=a.z+a.nz*hw*side, ay=a.y+0.1;
          const bx=b.x+b.nx*hw*side, bz=b.z+b.nz*hw*side, by=b.y+0.1;
          const dir=new THREE.Vector3(bx-ax, by-ay, bz-az); const dl=dir.length()||0.01; dir.normalize();
          const lip=new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, dl), lipMat);
          lip.position.set((ax+bx)/2, (ay+by)/2, (az+bz)/2);
          lip.quaternion.setFromUnitVectors(Z, dir);
          grp.add(lip);
        }
      }
      // side rails + posts (mirrors buildFenceMesh's "rail" style, run down each road edge)
      for (const side of [1,-1]){
        for (let i=0;i<path.length-1;i++){
          const a=path[i], b=path[i+1];
          for (const f of RAIL_FRACS){
            const ax=a.x+a.nx*hw*side, az=a.z+a.nz*hw*side, ay=a.y+RAIL_H*f;
            const bx=b.x+b.nx*hw*side, bz=b.z+b.nz*hw*side, by=b.y+RAIL_H*f;
            const dir=new THREE.Vector3(bx-ax, by-ay, bz-az); const dl=dir.length()||0.01; dir.normalize();
            const rail=new THREE.Mesh(new THREE.BoxGeometry(0.1,0.13,dl), railMat);
            rail.position.set((ax+bx)/2, (ay+by)/2, (az+bz)/2);
            rail.quaternion.setFromUnitVectors(Z, dir);
            grp.add(rail);
          }
        }
        let acc=0, next=0;
        for (let i=0;i<path.length;i++){
          if (i>0) acc += Math.hypot(path[i].x-path[i-1].x, path[i].z-path[i-1].z);
          if (acc>=next || i===path.length-1){
            const p=path[i];
            const px=p.x+p.nx*hw*side, pz=p.z+p.nz*hw*side;
            const post=new THREE.Mesh(new THREE.BoxGeometry(0.2, RAIL_H, 0.2), postMat);
            post.position.set(px, p.y+RAIL_H/2, pz);
            grp.add(post);
            next += POST_GAP;
          }
        }
      }
      // support pillars: from the road underside down to the terrain (groundFn), skipping short gaps
      let acc2=0, next2=0;
      for (let i=0;i<path.length;i++){
        if (i>0) acc2 += Math.hypot(path[i].x-path[i-1].x, path[i].z-path[i-1].z);
        if (acc2>=next2 || i===path.length-1){
          const p=path[i];
          const groundY = gfn(p.x, p.z);
          const deckUnderside = p.y - DECK_THICK;
          const gap = deckUnderside - groundY;
          if (gap >= MIN_PILLAR_GAP_Y){
            const bottom = groundY - PILLAR_FOOT, height = deckUnderside - bottom;
            const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, height, 0.6), pillarMat);
            pillar.position.set(p.x, bottom + height/2, p.z);
            grp.add(pillar);
            const foot = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.28, 1.15), pillarMat);
            foot.position.set(p.x, groundY - 0.05, p.z);
            grp.add(foot);
          }
          next2 += PILLAR_GAP;
        }
      }
    }
    return grp;
  }

  // ---- rampSurfaceY: world height of a ramp's driving surface at (x,z), or null if outside its
  // footprint. Ramp = a wedge object (type "ramp"): low edge at local -Z rising to full height (sy) at
  // local +Z, across width sx, rotated by rotY. The game folds this into the kart's height sampling so
  // driving up the slope lifts the kart and driving off the top edge launches it (K2.5 airborne).
  function rampSurfaceY(obj, x, z){
    const dx=x-obj.x, dz=z-obj.z;
    const c=Math.cos(obj.rotY||0), s=Math.sin(obj.rotY||0);
    const lx=dx*c - dz*s, lz=dx*s + dz*c;             // world -> ramp-local (undo rotY)
    const hw=(obj.sx||1)/2, hl=(obj.sz||1)/2;
    if (lx<-hw || lx>hw || lz<-hl || lz>hl) return null;
    const f=(lz+hl)/(2*hl);                            // 0 at low end (-Z) -> 1 at high end (+Z)
    return (obj.y||0) - (obj.sy||1)/2 + f*(obj.sy||1); // base (obj.y - sy/2) rising by f*sy
  }

  // ---- fenceCollide: kart-vs-fence push-out across ALL fence polylines (2D, in XZ). Returns the
  // deepest {nx,nz,over} (nx,nz = unit direction to push the kart AWAY from the fence) or null.
  // radius = kart half-width + fence half-thickness. Style-independent (posts and ribbon both use
  // the same polyline). Gaps in a polyline (separate fences) are naturally open — no segment, no wall.
  function fenceCollide(fences, x, z, radius){
    if (!fences || !fences.length) return null;
    let best = null, bestOver = 0;
    for (const f of fences){
      const pts = f.points; if (!pts || pts.length < 2) continue;
      for (let i=0;i<pts.length-1;i++){
        const a=pts[i], b=pts[i+1];
        const abx=b.x-a.x, abz=b.z-a.z, L2=abx*abx+abz*abz || 1e-6;
        let t=((x-a.x)*abx+(z-a.z)*abz)/L2; if(t<0)t=0; else if(t>1)t=1;
        const cx=a.x+abx*t, cz=a.z+abz*t, dx=x-cx, dz=z-cz;
        const d=Math.hypot(dx,dz), over=radius-d;
        if (over>0 && over>bestOver){
          let nx, nz;
          if (d > 1e-3){ nx=dx/d; nz=dz/d; }                 // push directly away from the contact point
          else { const sl=Math.hypot(abx,abz)||1; nx=-abz/sl; nz=abx/sl; }  // dead-on the line -> segment perpendicular
          best={nx, nz, over}; bestOver=over;
        }
      }
    }
    return best;
  }

  // ---- corridorFences: derive editable RIBBON fences from a track's corridor edges (the migration
  // path that replaces the old automatic corridor wall). Walks both road edges at half+margin, breaks
  // the polyline wherever another branch of the road overlaps (so legal self-crossings stay open), and
  // returns one ribbon fence per continuous edge run. Same geometry the old buildCorridorFence drew,
  // now as data the editor can edit/delete/replace. sampled = FK_TRACK.resample output.
  function corridorFences(sampled, width, margin){
    const C = sampled.centerPts, T = sampled.tangents, N = sampled.samples;
    const half = width/2, edge = half + (margin>0?margin:7);
    const meanSeg = sampled.trackLen / N;
    const idxWin = Math.max(6, Math.ceil((2*edge)/Math.max(0.5, meanSeg)));
    function otherBranchNear(x, z, atIdx){
      let bd = 1e18;
      for (let i=0;i<N;i++){
        const di = Math.min((i-atIdx+N)%N, (atIdx-i+N)%N);
        if (di < idxWin) continue;
        const c = C[i]; const dx=x-c.x, dz=z-c.z; const d=dx*dx+dz*dz; if(d<bd)bd=d;
      }
      return Math.sqrt(bd);
    }
    // decimate a dense edge run to ~one point per `spacing` units of arc (keeps endpoints) so the
    // resulting fence has a manageable, editable number of control points (the mesh re-densifies).
    const spacing = Math.max(9, edge);
    function decimate(pts){
      if (pts.length <= 2) return pts;
      const o = [pts[0]]; let acc = 0;
      for (let i=1;i<pts.length-1;i++){ acc += Math.hypot(pts[i].x-pts[i-1].x, pts[i].z-pts[i-1].z); if (acc>=spacing){ o.push(pts[i]); acc=0; } }
      o.push(pts[pts.length-1]); return o;
    }
    const out = [];
    for (let side=-1; side<=1; side+=2){
      const E = [], open = [];
      for (let i=0;i<N;i++){
        const c=C[i], t=T[i]; const nx=-t.z*side, nz=t.x*side;   // outward on this side
        const px=c.x+nx*edge, pz=c.z+nz*edge;
        E.push({x:px, z:pz}); open.push(otherBranchNear(px,pz,i) > edge);   // true = solid wall here
      }
      // extract maximal runs of consecutive open==true edge points into separate polylines
      let run = [];
      const flush = ()=>{ if (run.length>=2) out.push({ id:'wall_'+(out.length+1), tag:'corridor', style:'ribbon', height:1.2, points:decimate(run) }); run=[]; };
      for (let i=0;i<=N;i++){
        const k=i%N;
        if (i<N && open[k]) run.push({x:E[k].x, z:E[k].z});
        else flush();
      }
      flush();
    }
    return out;
  }

  // ---- validate: advisory warnings for the EDITOR (bowtie / self-intersection / spacing) ----
  // Returns { ok, warnings:[...], perPoint:[{idx, radius, tight}] }.
  function validate(track){
    const warnings = [];
    const notes = [];          // K7: advisory, non-error notes (do NOT flip ok=false)
    const perPoint = [];
    const pts = track.points, n = pts.length, hw = (track.width||18)/2;
    if (n < 8) warnings.push('Need at least 8 control points (have '+n+').');

    // min corner radius via circumradius of (prev, cur, next) control points
    let minR = Infinity, minRIdx = -1;
    for (let i=0;i<n;i++){
      const a=pts[(i-1+n)%n], b=pts[i], c=pts[(i+1)%n];
      const abx=b.x-a.x, abz=b.z-a.z, bcx=c.x-b.x, bcz=c.z-b.z, acx=c.x-a.x, acz=c.z-a.z;
      const A=Math.hypot(abx,abz), B=Math.hypot(bcx,bcz), C=Math.hypot(acx,acz);
      const area = Math.abs(abx*bcz - abz*bcx)/2;   // triangle area
      let R = Infinity;
      if (area > 1e-6) R = (A*B*C)/(4*area);
      perPoint.push({ idx:i, radius:R, tight:R < hw });
      if (R < minR){ minR = R; minRIdx = i; }
    }
    if (minR < hw){
      warnings.push('Corner at point '+minRIdx+' pinches (radius '+minR.toFixed(1)+' < half-width '+hw.toFixed(1)+') — the ribbon will bowtie.');
    }

    // min point spacing
    let minSpace = Infinity, minSpaceIdx = -1;
    for (let i=0;i<n;i++){
      const a=pts[i], b=pts[(i+1)%n];
      const d = Math.hypot(b.x-a.x, b.z-a.z);
      if (d < minSpace){ minSpace = d; minSpaceIdx = i; }
    }
    const minSpaceLimit = Math.max(2, hw*0.6);
    if (minSpace < minSpaceLimit){
      warnings.push('Points '+minSpaceIdx+' and '+((minSpaceIdx+1)%n)+' are only '+minSpace.toFixed(1)+' apart (min '+minSpaceLimit.toFixed(1)+').');
    }

    // self-intersection of the control polygon (non-adjacent segment pairs)
    function segInt(p1,p2,p3,p4){
      const d = (p2.x-p1.x)*(p4.z-p3.z) - (p2.z-p1.z)*(p4.x-p3.x);
      if (Math.abs(d) < 1e-9) return false;
      const t = ((p3.x-p1.x)*(p4.z-p3.z) - (p3.z-p1.z)*(p4.x-p3.x))/d;
      const u = ((p3.x-p1.x)*(p2.z-p1.z) - (p3.z-p1.z)*(p2.x-p1.x))/d;
      return t>1e-6 && t<1-1e-6 && u>1e-6 && u<1-1e-6;
    }
    // K7: self-intersection is now LEGAL (bridge / over-under crossings are supported by the
    // height-aware sampling in-game). It is a NOTE, not an error — never flips ok to false.
    let crossed = false;
    for (let i=0;i<n && !crossed;i++){
      const a1=pts[i], a2=pts[(i+1)%n];
      for (let j=i+1;j<n;j++){
        if (j===i || (j+1)%n===i || j===(i+1)%n) continue; // skip shared-vertex neighbors
        const b1=pts[j], b2=pts[(j+1)%n];
        if (segInt(a1,a2,b1,b2)){ crossed = true; notes.push('overlap OK (bridge) — segment '+i+' crosses segment '+j+'; give the two branches different elevation.'); break; }
      }
    }

    return { ok: warnings.length===0, warnings, notes, perPoint };
  }

  // ---- reverse: flip driving direction (points order + itemRows -> 1-s) ----
  function reverse(track){
    const t = JSON.parse(JSON.stringify(track));
    t.points.reverse();
    t.itemRows = (t.itemRows||[]).map(s => (1 - s)).filter(s=>s>=0 && s<=1).sort((a,b)=>a-b);
    // K7: boost pads flip along the lap (s -> 1-s) and across the width (lane -> -lane, the
    // left/right handedness reverses with direction).
    if (Array.isArray(t.boostPads)){
      t.boostPads = t.boostPads.map(b => ({ s:1-b.s, lane:-(b.lane||0) }))
        .filter(b => b.s>=0 && b.s<=1).sort((a,b)=>a.s-b.s);
    }
    return t;
  }

  // ================= TERRAIN (shared so the editor renders byte-identical to the game) =================
  // These were inline in farmkart.html; promoted here (parameterized by opts instead of the game's
  // TUNE globals) so the editor's WYSIWYG view uses the exact same math. opts = {amp, wave, margin}.
  // sampleField (P3): bilinear read of the user SCULPT heightfield — a sparse world-anchored grid
  // { cell, cells:{"i,j":delta} } where grid point (i,j) is at world (i*cell, j*cell). Missing = 0.
  // Additive delta on top of the procedural hills; absent -> 0 (empty world = unchanged terrain).
  function sampleField(field, x, z){
    if (!field || !field.cells) return 0;
    const C = field.cell || 6, c = field.cells;
    const fx = x/C, fz = z/C;
    const i0 = Math.floor(fx), j0 = Math.floor(fz);
    const tx = fx - i0, tz = fz - j0;
    const h00 = c[i0+','+j0]||0, h10 = c[(i0+1)+','+j0]||0, h01 = c[i0+','+(j0+1)]||0, h11 = c[(i0+1)+','+(j0+1)]||0;
    const a = h00 + (h10-h00)*tx, b = h01 + (h11-h01)*tx;
    return a + (b-a)*tz;
  }
  // sampleColor (P4): bilinear read of the user PAINT field — a sparse world-anchored grid
  // { cell, cells:{"i,j":0xRRGGBB} }. Unpainted cells fall back to baseRGB so painted patches blend
  // smoothly into the grass. Returns [r,g,b] in 0..1.
  function _rgb(hex){ return [((hex>>16)&255)/255, ((hex>>8)&255)/255, (hex&255)/255]; }
  function sampleColor(field, x, z, baseRGB){
    if (!field || !field.cells) return baseRGB;
    const C = field.cell || 6, c = field.cells;
    const fx=x/C, fz=z/C, i0=Math.floor(fx), j0=Math.floor(fz), tx=fx-i0, tz=fz-j0;
    const g=(i,j)=>{ const v=c[i+','+j]; return (v==null) ? baseRGB : _rgb(v); };
    const c00=g(i0,j0), c10=g(i0+1,j0), c01=g(i0,j0+1), c11=g(i0+1,j0+1), out=[0,0,0];
    for (let k=0;k<3;k++){ const a=c00[k]+(c10[k]-c00[k])*tx, b=c01[k]+(c11[k]-c01[k])*tx; out[k]=a+(b-a)*tz; }
    return out;
  }
  // groundHills: procedural rolling grass hills + the user sculpt field (opts.field, if any).
  function groundHills(x, z, opts){
    const amp = opts.amp, wl = opts.wave || 60;
    let h = amp * (
      0.60*Math.sin(x/wl*1.3 + z/wl*0.7) +
      0.40*Math.sin(x/wl*0.5 - z/wl*1.1 + 2.1)
    );
    if (opts.field) h += sampleField(opts.field, x, z);
    return h;
  }
  // sampleHeight: flat across the road width, smoothstep-blended out to the ground hills. This is
  // the SINGLE height authority for the kart, entities, and (on non-bridge spans) the grass mesh.
  function sampleHeight(sampled, x, z, width, opts){
    // FOLLOW TERRAIN: the road drapes on the land — height is just the ground everywhere (no flat
    // trackY, no skirt blend). The ribbon mesh + kart plane pick up the terrain tilt from this.
    if (opts.followTerrain) return groundHills(x, z, opts);
    const half = width/2;
    const margin = Math.max(0.5, opts.margin);
    const info = nearestOnCenter(sampled, x, z);
    const trackY = info.y, dist = info.dist;
    if (dist <= half) return trackY;
    const gy = groundHills(x, z, opts);
    if (dist >= half + margin) return gy;
    const t = (dist - half) / margin;
    const s = t*t*(3 - 2*t);
    return trackY*(1 - s) + gy*s;
  }
  // Bridge gap (m): if two road branches under the same XZ differ by more than this, treat as a
  // real over/under and keep open air under the high span. Below this = sampling noise / same level.
  const BRIDGE_Y_GAP = 1.5;
  // Lowest-branch height (legacy groundSampleHeight). Only used under true multi-level overlaps so
  // a bridge ribbon can float above the grass instead of dragging a steep skirt up to the deck.
  function _lowestBranchHeight(sampled, x, z, width, opts){
    const half = width/2;
    const margin = Math.max(0.5, opts.margin);
    const C = sampled.centerPts, N = sampled.samples;
    const band = half + margin, band2 = band*band;
    let underY = Infinity;
    let bandY = Infinity, bandDist = Infinity;
    for (let i=0;i<N;i++){
      const a=C[i], bpt=C[(i+1)%N];
      const abx=bpt.x-a.x, abz=bpt.z-a.z, L2=abx*abx+abz*abz || 1;
      let t=((x-a.x)*abx+(z-a.z)*abz)/L2; if (t<0) t=0; else if (t>1) t=1;
      const px=a.x+abx*t, pz=a.z+abz*t, d2=(x-px)*(x-px)+(z-pz)*(z-pz);
      if (d2 > band2) continue;
      const d=Math.sqrt(d2), y=a.y+(bpt.y-a.y)*t;
      if (d <= half && y < underY) underY = y;
      if (y < bandY){ bandY = y; bandDist = d; }
    }
    if (underY < Infinity) return underY;
    const gy = groundHills(x, z, opts);
    if (bandY < Infinity){
      const t = Math.min(1, Math.max(0, (bandDist - half)/margin));
      const s = t*t*(3 - 2*t);
      return bandY*(1 - s) + gy*s;
    }
    return gy;
  }
  // True multi-level road under (x,z)? Two centerline projections within the road half-width whose
  // elevations differ by > BRIDGE_Y_GAP (figure-8 / bridge). Same-level loops don't count.
  function _isMultiLevelRoad(sampled, x, z, width){
    const half = width/2, half2 = half*half;
    const C = sampled.centerPts, N = sampled.samples;
    let yMin = Infinity, yMax = -Infinity, hits = 0;
    for (let i=0;i<N;i++){
      const a=C[i], bpt=C[(i+1)%N];
      const abx=bpt.x-a.x, abz=bpt.z-a.z, L2=abx*abx+abz*abz || 1;
      let t=((x-a.x)*abx+(z-a.z)*abz)/L2; if (t<0) t=0; else if (t>1) t=1;
      const px=a.x+abx*t, pz=a.z+abz*t, d2=(x-px)*(x-px)+(z-pz)*(z-pz);
      if (d2 > half2) continue;
      const y=a.y+(bpt.y-a.y)*t;
      if (y < yMin) yMin = y; if (y > yMax) yMax = y; hits++;
    }
    return hits >= 2 && (yMax - yMin) > BRIDGE_Y_GAP;
  }
  // groundSampleHeight: what the DISPLACED GRASS MESH uses.
  // Stage A (2026-07-09): match sampleHeight everywhere EXCEPT true bridge overlaps, where the
  // mesh stays on the LOWEST branch so the high ribbon floats in open air. Previously this always
  // used a different nearest/lowest walk than sampleHeight, so road-edge skirts disagreed with the
  // kart and buried/floated the body even on single-level tracks.
  function groundSampleHeight(sampled, x, z, width, opts){
    // FOLLOW TERRAIN is a single surface: the grass mesh IS the ground everywhere (no bridge branch,
    // no double-apply). Explicit early return keeps _isMultiLevelRoad from firing on authored y's.
    if (opts.followTerrain) return groundHills(x, z, opts);
    if (_isMultiLevelRoad(sampled, x, z, width)) return _lowestBranchHeight(sampled, x, z, width, opts);
    return sampleHeight(sampled, x, z, width, opts);
  }
  // FLUFFY GRASS: a cached GRAYSCALE blade-noise texture that MODULATES the ground vertex colour, so
  // grass reads as soft mown turf (and painted dirt/sand keep their hue but gain the same fluff). No
  // per-frame cost — generated once. Falls back to null off-DOM.
  let _grassTex = null;
  function _grassTexture(THREE){
    if (_grassTex !== null) return _grassTex || null;
    if (typeof document === 'undefined'){ _grassTex = false; return null; }
    const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = 'rgb(244,244,244)'; ctx.fillRect(0,0,S,S);            // base ~0.96 (barely darkens)
    for (let i=0;i<44;i++){ const x=(i*79.7)%S, y=(i*131.3)%S, r=18+((i*53)%46); // soft tonal blotches
      const g = (i%2) ? 210 : 255; ctx.fillStyle='rgba('+g+','+g+','+g+',0.09)';
      ctx.beginPath(); ctx.arc(x,y,r,0,7); ctx.fill(); }
    let s = 1234567;                                                       // deterministic PRNG (stable tiles)
    const rnd = ()=>{ s = (s*1103515245 + 12345) & 0x7fffffff; return s/0x7fffffff; };
    for (let i=0;i<5200;i++){ const x=rnd()*S, y=rnd()*S, h=2+rnd()*4, v=Math.floor(188+rnd()*72);
      ctx.strokeStyle='rgb('+v+','+v+','+v+')'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+(rnd()-0.5)*1.5, y-h); ctx.stroke(); }
    const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true; _grassTex = tex; return tex;
  }
  // buildGroundMesh: the displaced ground grid (grass + hills). Grid over the track bbox + margin,
  // each vertex dropped to groundSampleHeight; a soft muted-green base (+ gentle tonal patches) is
  // vertex-coloured and a grayscale blade texture (world-tiled UVs) modulates it for a fluffy look.
  // opts may add groundMargin(55) / seg(4) / color; vertexColorFn(x,z,h)->[r,g,b] (paint) overrides.
  function buildGroundMesh(sampled, width, THREE, opts){
    const centerPts = sampled.centerPts;
    let minX=1e9,maxX=-1e9,minZ=1e9,maxZ=-1e9;
    for (const c of centerPts){ if(c.x<minX)minX=c.x; if(c.x>maxX)maxX=c.x; if(c.z<minZ)minZ=c.z; if(c.z>maxZ)maxZ=c.z; }
    const M = (opts.groundMargin!=null)?opts.groundMargin:55; minX-=M; maxX+=M; minZ-=M; maxZ+=M;
    // Denser grid (was 4) so rolling hills don't bulge above sampleHeight between verts
    // and bury the kart. Slightly heavier mesh; still fine on phones.
    const seg = opts.seg || 2.5;
    const nx = Math.ceil((maxX-minX)/seg), nz = Math.ceil((maxZ-minZ)/seg);
    const pos = [], idx = [], colors = [], uvs = [];
    // softer, muted grass green (the old flat 0x6fae54 read too sharp). Gentle low-freq brightness
    // "patch" variation keeps large areas from looking uniformly flat.
    const BASE_GRASS = (opts.color!=null) ? opts.color : 0x86a862, baseRGB = _rgb(BASE_GRASS);
    const patch = (x,z)=> 0.9 + 0.1*(0.5 + 0.5*Math.sin(x*0.021 + z*0.013)*Math.cos(z*0.017 - x*0.009));
    const paintOn = !!(opts.paint && opts.paint.cells && Object.keys(opts.paint.cells).length);
    const ext = opts.vertexColorFn || null;
    const UVT = 5;   // texture tiles every 5 world units (blade scale)
    for (let j=0;j<=nz;j++) for (let i=0;i<=nx;i++){
      const x = minX + i*seg, z = minZ + j*seg;
      const h = groundSampleHeight(sampled, x, z, width, opts);
      pos.push(x, h, z);
      uvs.push(x/UVT, z/UVT);
      let c;
      if (ext) c = ext(x, z, h);                                   // external override (rare)
      else { const m = patch(x,z);
        const base = paintOn ? sampleColor(opts.paint, x, z, baseRGB) : baseRGB;
        c = [base[0]*m, base[1]*m, base[2]*m]; }                   // grass/paint colour, patch-modulated
      colors.push(c[0], c[1], c[2]);
    }
    for (let j=0;j<nz;j++) for (let i=0;i<nx;i++){
      const a = j*(nx+1)+i, b = a+1, c = a+(nx+1), d = c+1;
      idx.push(a, c, b,  b, c, d);
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    gg.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    gg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    gg.setIndex(idx);
    gg.computeVertexNormals();
    // white material (vertex colour carries the hue); the grayscale blade texture modulates it fluffy.
    return new THREE.Mesh(gg, new THREE.MeshLambertMaterial({
      color:0xffffff, map:_grassTexture(THREE), vertexColors:true, side:THREE.DoubleSide
    }));
  }

  // ---- GRASS TUFTS (3D fluff): one InstancedMesh of crossed-quad tufts scattered in a band along
  // the track corridor (where the camera looks), seated on the terrain. Cheap: ~1 draw call, static
  // (no per-frame cost). Cached blade geometry + a white-blade alpha texture tinted per-instance. ----
  let _tuftGeo = null, _tuftTex = null;
  function _makeTuftGeo(THREE){
    if (_tuftGeo) return _tuftGeo;
    const w=1, h=1.4, v=[], uv=[], idx=[];
    const quad=(nx,nz)=>{ const b=v.length/3;
      v.push(-nx*w/2,0,-nz*w/2,  nx*w/2,0,nz*w/2,  nx*w/2,h,nz*w/2,  -nx*w/2,h,-nz*w/2);
      uv.push(0,0, 1,0, 1,1, 0,1); idx.push(b,b+1,b+2, b,b+2,b+3); };
    quad(1,0); quad(0,1);                       // two crossed quads -> reads 3D from any angle
    const g=new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v,3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv,2));
    g.setIndex(idx); g.computeVertexNormals(); _tuftGeo=g; return g;
  }
  function _makeTuftTex(THREE){
    if (_tuftTex !== null) return _tuftTex || null;
    if (typeof document === 'undefined'){ _tuftTex=false; return null; }
    const S=64, cv=document.createElement('canvas'); cv.width=cv.height=S; const ctx=cv.getContext('2d');
    ctx.clearRect(0,0,S,S);
    const blades=[[10,-5],[18,3],[26,-3],[33,4],[40,-4],[48,2],[55,-3]];   // [baseX, lean]
    for (const [bx,lean] of blades){ ctx.fillStyle='rgba(255,255,255,0.92)';
      ctx.beginPath(); ctx.moveTo(bx-3,S); ctx.lineTo(bx+3,S); ctx.lineTo(bx+lean, 8+(bx%14)); ctx.closePath(); ctx.fill(); }
    const tex=new THREE.CanvasTexture(cv); tex.needsUpdate=true; _tuftTex=tex; return tex;
  }
  function buildGrassTufts(sampled, width, THREE, opts){
    opts = opts || {};
    const hfn = opts.heightFn || (()=>0);
    const half = width/2, band = opts.band || 40, size = opts.size || 0.62;
    const C = sampled.centerPts, T = sampled.tangents, N = sampled.samples;
    const count = Math.min(opts.count || 4200, 14000);
    const mat = new THREE.MeshLambertMaterial({ color:0xffffff, map:_makeTuftTex(THREE), alphaTest:0.5, side:THREE.DoubleSide, transparent:false, emissive:0x2c3c1d });
    const mesh = new THREE.InstancedMesh(_makeTuftGeo(THREE), mat, count);
    const m=new THREE.Matrix4(), q=new THREE.Quaternion(), up=new THREE.Vector3(0,1,0), p=new THREE.Vector3(), sc=new THREE.Vector3(), col=new THREE.Color();
    let s = 987654321;
    const rnd = ()=>{ s=(s*1103515245+12345)&0x7fffffff; return s/0x7fffffff; };
    for (let i=0;i<count;i++){
      const k=Math.floor(rnd()*N), c=C[k], t=T[k], nx=-t.z, nz=t.x;
      const side = rnd()<0.5?-1:1, off = half+3.5 + rnd()*band, along = (rnd()-0.5)*6;
      const x = c.x + nx*off*side + t.x*along, z = c.z + nz*off*side + t.z*along;
      const sw = size*(0.8+rnd()*0.5);           // small ground tufts (knee-high at most)
      // the track LOOPS, so a tuft offset from sample k can still land on the road elsewhere — hide it
      // (zero scale) if it's within a road-width of ANY centerline branch.
      const onRoad = nearestOnCenter(sampled, x, z).dist < half + 2.5;
      p.set(x, hfn(x,z), z);
      if (onRoad) sc.set(0,0,0); else sc.set(sw, sw*(0.85+rnd()*0.45), sw);
      q.setFromAxisAngle(up, rnd()*6.2832);
      m.compose(p,q,sc); mesh.setMatrixAt(i,m);
      const g=0.4+rnd()*0.24; col.setRGB(g*0.72, g, g*0.42); mesh.setColorAt(i,col);
    }
    mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    return mesh;
  }

  // ---- trackDirectionAt: unit XZ tangent of the racing line nearest (x,z). Used so boost pads and
  // ramps ALWAYS face the driving direction (low→high for ramps = track forward).
  function trackDirectionAt(sampled, x, z){
    if (!sampled || !sampled.centerPts) return { x:0, z:1, yaw:0 };
    const n = nearestOnCenter(sampled, x, z);
    const t = sampled.tangents[n.idx] || { x:0, z:1 };
    const hl = Math.hypot(t.x, t.z) || 1;
    const tx = t.x / hl, tz = t.z / hl;
    return { x:tx, z:tz, yaw:Math.atan2(tx, tz) };
  }
  // Force every type:"ramp" object's rotY so local +Z (uphill) matches the track tangent at its center.
  // Mutates objects in place; safe to call at game boot and on every editor rebuild.
  function alignRampsToTrack(track, sampled){
    if (!track || !Array.isArray(track.objects) || !sampled) return;
    for (const o of track.objects){
      if (!o || o.type !== 'ramp') continue;
      o.rotY = trackDirectionAt(sampled, o.x, o.z).yaw;
    }
  }

  window.FK_TRACK = {
    VERSION:1, SAMPLES,
    DEFAULT_TRACK, BUILTIN_TRACKS,
    resample, buildRibbonGeometry, sanitize, validate, reverse, nearestOnCenter, nearestOnCenterAtY,
    groundHills, sampleHeight, groundSampleHeight, buildGroundMesh, buildObjectMesh, buildFenceMesh, buildGrassTufts, sampleField, sampleColor,
    fenceCollide, corridorFences, rampSurfaceY, buildTunnelMesh, buildBridgeMesh, trackDirectionAt, alignRampsToTrack
  };
})();
