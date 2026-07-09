// Farm Kart prop library — CC0 low-poly models (Kenney Nature Kit + Quaternius Farm Buildings,
// both Public Domain / CC0). Loaded by farmkart.html (game) and farmkart-editor.html (editor).
// Each prop GLB is normalized at load into a UNIT box (base at y=-0.5, centered XZ) so it drops into
// the same object system as blocks — object (x,y,z)=center, (sx,sy,sz) scale, rotY.
(function(){
  window.FK_PROPS_BASE = "assets/farmkart/props/";
  window.FK_PROPS = [{"id":"campfire_logs","name":"Campfire Logs","file":"campfire_logs.glb","cat":"prop","size":5},{"id":"canoe","name":"Canoe","file":"canoe.glb","cat":"prop","size":5},{"id":"crop_melon","name":"Crop Melon","file":"crop_melon.glb","cat":"crop","size":4},{"id":"crop_pumpkin","name":"Crop Pumpkin","file":"crop_pumpkin.glb","cat":"crop","size":4},{"id":"crops_cornStageD","name":"Crops CornStageD","file":"crops_cornStageD.glb","cat":"crop","size":4},{"id":"crops_wheatStageB","name":"Crops WheatStageB","file":"crops_wheatStageB.glb","cat":"crop","size":4},{"id":"farm_barn","name":"Barn","file":"farm_barn.glb","cat":"building","size":16},{"id":"farm_big_barn","name":"Big Barn","file":"farm_big_barn.glb","cat":"building","size":16},{"id":"farm_chickencoop","name":"Chickencoop","file":"farm_chickencoop.glb","cat":"building","size":16},{"id":"farm_fence","name":"Fence","file":"farm_fence.glb","cat":"fence","size":6},{"id":"farm_open_barn","name":"Open Barn","file":"farm_open_barn.glb","cat":"building","size":16},{"id":"farm_silo","name":"Silo","file":"farm_silo.glb","cat":"building","size":16},{"id":"farm_silo_house","name":"Silo House","file":"farm_silo_house.glb","cat":"building","size":16},{"id":"farm_small_barn","name":"Small Barn","file":"farm_small_barn.glb","cat":"building","size":16},{"id":"farm_tower_windmill","name":"Tower Windmill","file":"farm_tower_windmill.glb","cat":"building","size":16},{"id":"fence_gate","name":"Fence Gate","file":"fence_gate.glb","cat":"fence","size":6},{"id":"fence_planks","name":"Fence Planks","file":"fence_planks.glb","cat":"fence","size":6},{"id":"fence_simple","name":"Fence Simple","file":"fence_simple.glb","cat":"fence","size":6},{"id":"flower_purpleA","name":"Flower PurpleA","file":"flower_purpleA.glb","cat":"plant","size":3},{"id":"flower_redA","name":"Flower RedA","file":"flower_redA.glb","cat":"plant","size":3},{"id":"flower_yellowA","name":"Flower YellowA","file":"flower_yellowA.glb","cat":"plant","size":3},{"id":"grass_large","name":"Grass Large","file":"grass_large.glb","cat":"plant","size":3},{"id":"grass_leafsLarge","name":"Grass LeafsLarge","file":"grass_leafsLarge.glb","cat":"plant","size":3},{"id":"lily_large","name":"Lily Large","file":"lily_large.glb","cat":"plant","size":3},{"id":"log","name":"Log","file":"log.glb","cat":"log","size":5},{"id":"log_stack","name":"Log Stack","file":"log_stack.glb","cat":"log","size":5},{"id":"mushroom_red","name":"Mushroom Red","file":"mushroom_red.glb","cat":"plant","size":3},{"id":"plant_bush","name":"Plant Bush","file":"plant_bush.glb","cat":"plant","size":3},{"id":"plant_bushLarge","name":"Plant BushLarge","file":"plant_bushLarge.glb","cat":"plant","size":3},{"id":"plant_bushSmall","name":"Plant BushSmall","file":"plant_bushSmall.glb","cat":"plant","size":3},{"id":"pot_large","name":"Pot Large","file":"pot_large.glb","cat":"prop","size":5},{"id":"rock_largeA","name":"Rock LargeA","file":"rock_largeA.glb","cat":"rock","size":5},{"id":"rock_largeC","name":"Rock LargeC","file":"rock_largeC.glb","cat":"rock","size":5},{"id":"rock_smallA","name":"Rock SmallA","file":"rock_smallA.glb","cat":"rock","size":5},{"id":"rock_smallD","name":"Rock SmallD","file":"rock_smallD.glb","cat":"rock","size":5},{"id":"rock_tallA","name":"Rock TallA","file":"rock_tallA.glb","cat":"rock","size":5},{"id":"rock_tallD","name":"Rock TallD","file":"rock_tallD.glb","cat":"rock","size":5},{"id":"sign","name":"Sign","file":"sign.glb","cat":"prop","size":5},{"id":"stone_largeA","name":"Stone LargeA","file":"stone_largeA.glb","cat":"rock","size":5},{"id":"stone_smallA","name":"Stone SmallA","file":"stone_smallA.glb","cat":"rock","size":5},{"id":"stone_tallA","name":"Stone TallA","file":"stone_tallA.glb","cat":"rock","size":5},{"id":"stump_old","name":"Stump Old","file":"stump_old.glb","cat":"log","size":5},{"id":"stump_round","name":"Stump Round","file":"stump_round.glb","cat":"log","size":5},{"id":"tent_smallClosed","name":"Tent SmallClosed","file":"tent_smallClosed.glb","cat":"prop","size":5},{"id":"tree_cone","name":"Tree Cone","file":"tree_cone.glb","cat":"tree","size":9},{"id":"tree_default","name":"Tree Default","file":"tree_default.glb","cat":"tree","size":9},{"id":"tree_default_fall","name":"Tree Default Fall","file":"tree_default_fall.glb","cat":"tree","size":9},{"id":"tree_detailed","name":"Tree Detailed","file":"tree_detailed.glb","cat":"tree","size":9},{"id":"tree_fat","name":"Tree Fat","file":"tree_fat.glb","cat":"tree","size":9},{"id":"tree_oak","name":"Tree Oak","file":"tree_oak.glb","cat":"tree","size":9},{"id":"tree_palm","name":"Tree Palm","file":"tree_palm.glb","cat":"tree","size":9},{"id":"tree_pineRoundA","name":"Tree PineRoundA","file":"tree_pineRoundA.glb","cat":"tree","size":9},{"id":"tree_pineSmallA","name":"Tree PineSmallA","file":"tree_pineSmallA.glb","cat":"tree","size":9},{"id":"tree_pineTallA","name":"Tree PineTallA","file":"tree_pineTallA.glb","cat":"tree","size":9},{"id":"tree_small","name":"Tree Small","file":"tree_small.glb","cat":"tree","size":9},{"id":"tree_tall","name":"Tree Tall","file":"tree_tall.glb","cat":"tree","size":9},{"id":"tree_thin","name":"Tree Thin","file":"tree_thin.glb","cat":"tree","size":9}];
  // load a set of prop ids (or all) -> Promise<{id:{scene,norm:{s,ox,oy,oz}}}>. Needs THREE + GLTFLoader.
  window.FK_loadProps = function(ids, THREE, baseUrl, onOne){
    baseUrl = baseUrl || window.FK_PROPS_BASE;
    const loader = new THREE.GLTFLoader();
    const cache = {};
    const list = (ids && ids.length) ? ids : window.FK_PROPS.map(p=>p.id);
    return Promise.all(list.map(id=>{
      const def = window.FK_PROPS.find(p=>p.id===id); if(!def) return Promise.resolve();
      return new Promise(res=>{
        loader.load(baseUrl+def.file, gltf=>{
          const scene = gltf.scene;
          // GLTF ships PBR MeshStandardMaterial, which renders near-black under the game's toon
          // (Hemisphere + Directional) lighting with no env map. Convert to MeshLambert, preserving
          // the model's color / texture / vertex-colors, so props light the same as the grass + kart.
          scene.traverse(o=>{
            if (!o.isMesh || !o.material) return;
            const src = Array.isArray(o.material) ? o.material[0] : o.material;
            const hasVC = !!(o.geometry && o.geometry.attributes && o.geometry.attributes.color);
            const hasMap = !!(src && src.map);
            // Lambert final color = material.color * (vertexColor | mapTexel). When the model carries
            // its palette in VERTEX COLORS or a TEXTURE, force material.color WHITE so it shows at full
            // strength (a dark PBR base color would otherwise multiply it down to near-black). Only a
            // plain untextured/unvertex-colored mesh keeps its material color.
            const baseCol = (hasVC || hasMap) ? new THREE.Color(0xffffff) : ((src && src.color) ? src.color.clone() : new THREE.Color(0xcccccc));
            // GLTF baseColorFactor is LINEAR; this scene renders in a linear-ish workflow tuned for the
            // hand-picked grass/kart colors, so the models come out dark (#330a08 = a dark maroon).
            // Gamma-correct to sRGB so a barn reads as barn-red, matching the rest of the scene.
            if (!hasVC && !hasMap) baseCol.convertLinearToSRGB();
            o.material = new THREE.MeshLambertMaterial({
              color: baseCol,
              map: hasMap ? src.map : null,
              vertexColors: hasVC,
              // EMISSIVE lift: these packs use darker solid colors + this scene's directional light
              // leaves side faces near-black. A fraction of the base color as emissive gives the flat,
              // brighter toon look (shadowed faces read as the object's colour, not black).
              emissive: baseCol.clone().multiplyScalar(0.34),
              emissiveMap: hasMap ? src.map : null,
              transparent: !!(src && src.transparent),
              opacity: (src && src.opacity!=null) ? src.opacity : 1,
              side: (src && src.side) || THREE.FrontSide
            });
          });
          const box = new THREE.Box3().setFromObject(scene);
          const sx=box.max.x-box.min.x, sy=box.max.y-box.min.y, sz=box.max.z-box.min.z;
          const maxD = Math.max(sx,sy,sz)||1, s = 1/maxD;
          const cx=(box.min.x+box.max.x)/2, cz=(box.min.z+box.max.z)/2;
          cache[id] = { scene, norm:{ s, ox:-cx*s, oy:-box.min.y*s - 0.5, oz:-cz*s } };
          if(onOne)onOne(id); res();
        }, undefined, ()=>{ if(onOne)onOne(id); res(); });
      });
    })).then(()=>cache);
  };
})();
