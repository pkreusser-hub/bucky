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
       boostPads:[{s,lane}...] }    // K7 OPTIONAL boost pads: s=0..1 lap fraction, lane=-1..1 across width

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
  function buildRibbonGeometry(sampled, width, THREE){
    const centerPts = sampled.centerPts, tangents = sampled.tangents, N = sampled.samples;
    const hw = width/2, curbW = 0.55;
    function closedRibbon(offL, offR, color, layerY){
      const pos = [];
      for (let i=0;i<N;i++){
        const c = centerPts[i], t = tangents[i];
        const nx = -t.z, nz = t.x; // left normal in XZ
        const y = c.y + layerY;
        pos.push(c.x + nx*offL, y, c.z + nz*offL);
        pos.push(c.x + nx*offR, y, c.z + nz*offR);
      }
      const idx = [];
      for (let i=0;i<N;i++){
        const j = (i+1)%N;
        const Li=i*2, Ri=i*2+1, Lj=j*2, Rj=j*2+1;
        idx.push(Li, Ri, Lj); idx.push(Ri, Rj, Lj);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx); g.computeVertexNormals();
      return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, side:THREE.DoubleSide }));
    }
    const grp = new THREE.Group();
    grp.add(closedRibbon(+hw, -hw, 0x33373d, 0.08));
    grp.add(closedRibbon(+hw, +(hw - curbW), 0xdfe4ea, 0.12));
    grp.add(closedRibbon(-(hw - curbW), -hw, 0xdfe4ea, 0.12));
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
          objs.push({
            id:   (typeof o.id==='string' && o.id)   ? o.id.slice(0,40) : ('obj_'+(objs.length+1)),
            tag:  (typeof o.tag==='string')          ? o.tag.slice(0,60) : '',
            type: (typeof o.type==='string' && o.type)? o.type.slice(0,24) : 'block',
            x, y, z,
            rotY: num(o.rotY, 0),
            sx: Math.max(0.2, num(o.sx, 6)), sy: Math.max(0.2, num(o.sy, 6)), sz: Math.max(0.2, num(o.sz, 6)),
            color: (typeof o.color==='number') ? o.color : (typeof o.color==='string' ? o.color : 0xc8a06a)
          });
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
      return out;
    }catch(e){ return null; }
  }

  // ---- buildObjectMesh: one placed world object -> a THREE.Group at its CENTER, scaled + yaw'd.
  // Shared so the editor and game render identical massing. type "block" = a box; add cases here as
  // real props (barn/house/fence...) get designed. opts.ghost = translucent (editor placeholder look).
  function buildObjectMesh(obj, THREE, opts){
    opts = opts || {};
    const g = new THREE.Group();
    const isWater = obj.type === 'water';
    let color = obj.color;
    if (typeof color === 'string') color = parseInt(String(color).replace('#','0x'));
    if (!isFinite(color)) color = isWater ? 0x2f6fb0 : 0xc8a06a;
    const mat = new THREE.MeshLambertMaterial({
      color,
      transparent: isWater || !!opts.ghost,
      opacity: isWater ? 0.72 : (opts.ghost ? 0.5 : 1),
      depthWrite: !isWater
    });
    const box = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), mat);   // unit cube centered at local origin
    if (isWater) box.renderOrder = 3;                                // water blends over terrain
    g.add(box);
    g.position.set(obj.x, obj.y, obj.z);
    g.scale.set(obj.sx||1, obj.sy||1, obj.sz||1);
    g.rotation.y = obj.rotY || 0;
    g.userData.objId = obj.id;
    return g;
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
  // what the kart / camera / entities read (nearest-branch on-track height).
  function sampleHeight(sampled, x, z, width, opts){
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
  // groundSampleHeight: the DISPLACED-GROUND-MESH height. Under a road it follows the LOWEST branch
  // (a higher bridge floats above it = open air); elsewhere it blends to the ground hills.
  function groundSampleHeight(sampled, x, z, width, opts){
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
  // buildGroundMesh: the displaced ground grid (grass + hills). Byte-identical to the game's inline
  // block (grid over the track bbox + margin, each vertex dropped to groundSampleHeight). opts may
  // add groundMargin(55) / seg(4) / color(0x6fae54); vertexColorFn(x,z,h)->[r,g,b] optional (paint).
  function buildGroundMesh(sampled, width, THREE, opts){
    const centerPts = sampled.centerPts;
    let minX=1e9,maxX=-1e9,minZ=1e9,maxZ=-1e9;
    for (const c of centerPts){ if(c.x<minX)minX=c.x; if(c.x>maxX)maxX=c.x; if(c.z<minZ)minZ=c.z; if(c.z>maxZ)maxZ=c.z; }
    const M = (opts.groundMargin!=null)?opts.groundMargin:55; minX-=M; maxX+=M; minZ-=M; maxZ+=M;
    const seg = opts.seg || 4;
    const nx = Math.ceil((maxX-minX)/seg), nz = Math.ceil((maxZ-minZ)/seg);
    const pos = [], idx = [], colors = [];
    // P4 paint: if a non-empty paint field is present, colour each vertex by sampling it (unpainted
    // -> base grass, so patches blend). Absent -> no color attribute (mesh byte-identical to before).
    const BASE_GRASS = 0x6fae54, baseRGB = _rgb(BASE_GRASS);
    let cfn = opts.vertexColorFn || null;
    if (!cfn && opts.paint && opts.paint.cells && Object.keys(opts.paint.cells).length){
      cfn = (x,z)=>sampleColor(opts.paint, x, z, baseRGB);
    }
    for (let j=0;j<=nz;j++) for (let i=0;i<=nx;i++){
      const x = minX + i*seg, z = minZ + j*seg;
      const h = groundSampleHeight(sampled, x, z, width, opts);
      pos.push(x, h, z);
      if (cfn){ const c = cfn(x, z, h); colors.push(c[0], c[1], c[2]); }
    }
    for (let j=0;j<nz;j++) for (let i=0;i<nx;i++){
      const a = j*(nx+1)+i, b = a+1, c = a+(nx+1), d = c+1;
      idx.push(a, c, b,  b, c, d);
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (cfn) gg.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    gg.setIndex(idx);
    gg.computeVertexNormals();
    // when vertex colours drive the look, the material must be WHITE (it multiplies the vertex color).
    const color = cfn ? 0xffffff : ((opts.color!=null)?opts.color:BASE_GRASS);
    return new THREE.Mesh(gg, new THREE.MeshLambertMaterial({ color, side:THREE.DoubleSide, vertexColors: !!cfn }));
  }

  window.FK_TRACK = {
    VERSION:1, SAMPLES,
    DEFAULT_TRACK, BUILTIN_TRACKS,
    resample, buildRibbonGeometry, sanitize, validate, reverse, nearestOnCenter, nearestOnCenterAtY,
    groundHills, sampleHeight, groundSampleHeight, buildGroundMesh, buildObjectMesh, sampleField, sampleColor
  };
})();
