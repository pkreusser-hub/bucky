var dy=Object.defineProperty;var fy=(i,t,e)=>t in i?dy(i,t,{enumerable:!0,configurable:!0,writable:!0,value:e}):i[t]=e;var Bn=(i,t,e)=>fy(i,typeof t!="symbol"?t+"":t,e);(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const s of document.querySelectorAll('link[rel="modulepreload"]'))n(s);new MutationObserver(s=>{for(const r of s)if(r.type==="childList")for(const o of r.addedNodes)o.tagName==="LINK"&&o.rel==="modulepreload"&&n(o)}).observe(document,{childList:!0,subtree:!0});function e(s){const r={};return s.integrity&&(r.integrity=s.integrity),s.referrerPolicy&&(r.referrerPolicy=s.referrerPolicy),s.crossOrigin==="use-credentials"?r.credentials="include":s.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function n(s){if(s.ep)return;s.ep=!0;const r=e(s);fetch(s.href,r)}})();/**
 * @license
 * Copyright 2010-2024 Three.js Authors
 * SPDX-License-Identifier: MIT
 */const pd="169",V2={ROTATE:0,DOLLY:1,PAN:2},B2={ROTATE:0,PAN:1,DOLLY_PAN:2,DOLLY_ROTATE:3},py=0,Zf=1,my=2,$g=1,gy=2,Ui=3,yi=0,Dn=1,ei=2,cs=0,Br=1,Qf=2,tp=3,ep=4,_y=5,Vs=100,vy=101,yy=102,xy=103,Ey=104,Ty=200,Sy=201,Ay=202,My=203,Ju=204,Zu=205,wy=206,by=207,Ry=208,Iy=209,Cy=210,Py=211,Dy=212,Ly=213,Ny=214,Qu=0,th=1,eh=2,qr=3,nh=4,ih=5,sh=6,rh=7,md=0,Uy=1,Oy=2,ls=0,Fy=1,Vy=2,By=3,ky=4,zy=5,Hy=6,Gy=7,np="attached",Wy="detached",Yg=300,jr=301,Kr=302,oh=303,ah=304,Al=306,Ks=1e3,ss=1001,Yc=1002,Rn=1003,Jg=1004,Wo=1005,Fn=1006,Nc=1007,Fi=1008,ki=1009,Zg=1010,Qg=1011,la=1012,gd=1013,$s=1014,si=1015,Ia=1016,_d=1017,vd=1018,$r=1020,t_=35902,e_=1021,n_=1022,Xn=1023,i_=1024,s_=1025,kr=1026,Yr=1027,yd=1028,xd=1029,r_=1030,Ed=1031,Td=1033,Uc=33776,Oc=33777,Fc=33778,Vc=33779,ch=35840,lh=35841,uh=35842,hh=35843,dh=36196,fh=37492,ph=37496,mh=37808,gh=37809,_h=37810,vh=37811,yh=37812,xh=37813,Eh=37814,Th=37815,Sh=37816,Ah=37817,Mh=37818,wh=37819,bh=37820,Rh=37821,Bc=36492,Ih=36494,Ch=36495,o_=36283,Ph=36284,Dh=36285,Lh=36286,Xy=2200,qy=2201,jy=2202,ua=2300,ha=2301,Yl=2302,Ur=2400,Or=2401,Jc=2402,Sd=2500,Ky=2501,$y=0,a_=1,Nh=2,Yy=3200,Jy=3201,Ad=0,Zy=1,ns="",hn="srgb",fn="srgb-linear",Md="display-p3",Ml="display-p3-linear",Zc="linear",Ie="srgb",Qc="rec709",tl="p3",hr=7680,ip=519,Qy=512,tx=513,ex=514,c_=515,nx=516,ix=517,sx=518,rx=519,Uh=35044,sp="300 es",Vi=2e3,el=2001;class Ms{addEventListener(t,e){this._listeners===void 0&&(this._listeners={});const n=this._listeners;n[t]===void 0&&(n[t]=[]),n[t].indexOf(e)===-1&&n[t].push(e)}hasEventListener(t,e){if(this._listeners===void 0)return!1;const n=this._listeners;return n[t]!==void 0&&n[t].indexOf(e)!==-1}removeEventListener(t,e){if(this._listeners===void 0)return;const s=this._listeners[t];if(s!==void 0){const r=s.indexOf(e);r!==-1&&s.splice(r,1)}}dispatchEvent(t){if(this._listeners===void 0)return;const n=this._listeners[t.type];if(n!==void 0){t.target=this;const s=n.slice(0);for(let r=0,o=s.length;r<o;r++)s[r].call(this,t);t.target=null}}}const yn=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"];let rp=1234567;const Jo=Math.PI/180,Jr=180/Math.PI;function qn(){const i=Math.random()*4294967295|0,t=Math.random()*4294967295|0,e=Math.random()*4294967295|0,n=Math.random()*4294967295|0;return(yn[i&255]+yn[i>>8&255]+yn[i>>16&255]+yn[i>>24&255]+"-"+yn[t&255]+yn[t>>8&255]+"-"+yn[t>>16&15|64]+yn[t>>24&255]+"-"+yn[e&63|128]+yn[e>>8&255]+"-"+yn[e>>16&255]+yn[e>>24&255]+yn[n&255]+yn[n>>8&255]+yn[n>>16&255]+yn[n>>24&255]).toLowerCase()}function $e(i,t,e){return Math.max(t,Math.min(e,i))}function wd(i,t){return(i%t+t)%t}function ox(i,t,e,n,s){return n+(i-t)*(s-n)/(e-t)}function ax(i,t,e){return i!==t?(e-i)/(t-i):0}function Zo(i,t,e){return(1-e)*i+e*t}function cx(i,t,e,n){return Zo(i,t,1-Math.exp(-e*n))}function lx(i,t=1){return t-Math.abs(wd(i,t*2)-t)}function ux(i,t,e){return i<=t?0:i>=e?1:(i=(i-t)/(e-t),i*i*(3-2*i))}function hx(i,t,e){return i<=t?0:i>=e?1:(i=(i-t)/(e-t),i*i*i*(i*(i*6-15)+10))}function dx(i,t){return i+Math.floor(Math.random()*(t-i+1))}function fx(i,t){return i+Math.random()*(t-i)}function px(i){return i*(.5-Math.random())}function mx(i){i!==void 0&&(rp=i);let t=rp+=1831565813;return t=Math.imul(t^t>>>15,t|1),t^=t+Math.imul(t^t>>>7,t|61),((t^t>>>14)>>>0)/4294967296}function gx(i){return i*Jo}function _x(i){return i*Jr}function vx(i){return(i&i-1)===0&&i!==0}function yx(i){return Math.pow(2,Math.ceil(Math.log(i)/Math.LN2))}function xx(i){return Math.pow(2,Math.floor(Math.log(i)/Math.LN2))}function Ex(i,t,e,n,s){const r=Math.cos,o=Math.sin,a=r(e/2),c=o(e/2),l=r((t+n)/2),h=o((t+n)/2),d=r((t-n)/2),f=o((t-n)/2),p=r((n-t)/2),v=o((n-t)/2);switch(s){case"XYX":i.set(a*h,c*d,c*f,a*l);break;case"YZY":i.set(c*f,a*h,c*d,a*l);break;case"ZXZ":i.set(c*d,c*f,a*h,a*l);break;case"XZX":i.set(a*h,c*v,c*p,a*l);break;case"YXY":i.set(c*p,a*h,c*v,a*l);break;case"ZYZ":i.set(c*v,c*p,a*h,a*l);break;default:console.warn("THREE.MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: "+s)}}function ni(i,t){switch(t.constructor){case Float32Array:return i;case Uint32Array:return i/4294967295;case Uint16Array:return i/65535;case Uint8Array:return i/255;case Int32Array:return Math.max(i/2147483647,-1);case Int16Array:return Math.max(i/32767,-1);case Int8Array:return Math.max(i/127,-1);default:throw new Error("Invalid component type.")}}function xe(i,t){switch(t.constructor){case Float32Array:return i;case Uint32Array:return Math.round(i*4294967295);case Uint16Array:return Math.round(i*65535);case Uint8Array:return Math.round(i*255);case Int32Array:return Math.round(i*2147483647);case Int16Array:return Math.round(i*32767);case Int8Array:return Math.round(i*127);default:throw new Error("Invalid component type.")}}const Tx={DEG2RAD:Jo,RAD2DEG:Jr,generateUUID:qn,clamp:$e,euclideanModulo:wd,mapLinear:ox,inverseLerp:ax,lerp:Zo,damp:cx,pingpong:lx,smoothstep:ux,smootherstep:hx,randInt:dx,randFloat:fx,randFloatSpread:px,seededRandom:mx,degToRad:gx,radToDeg:_x,isPowerOfTwo:vx,ceilPowerOfTwo:yx,floorPowerOfTwo:xx,setQuaternionFromProperEuler:Ex,normalize:xe,denormalize:ni};class dt{constructor(t=0,e=0){dt.prototype.isVector2=!0,this.x=t,this.y=e}get width(){return this.x}set width(t){this.x=t}get height(){return this.y}set height(t){this.y=t}set(t,e){return this.x=t,this.y=e,this}setScalar(t){return this.x=t,this.y=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;default:throw new Error("index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y)}copy(t){return this.x=t.x,this.y=t.y,this}add(t){return this.x+=t.x,this.y+=t.y,this}addScalar(t){return this.x+=t,this.y+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this}subScalar(t){return this.x-=t,this.y-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this}multiply(t){return this.x*=t.x,this.y*=t.y,this}multiplyScalar(t){return this.x*=t,this.y*=t,this}divide(t){return this.x/=t.x,this.y/=t.y,this}divideScalar(t){return this.multiplyScalar(1/t)}applyMatrix3(t){const e=this.x,n=this.y,s=t.elements;return this.x=s[0]*e+s[3]*n+s[6],this.y=s[1]*e+s[4]*n+s[7],this}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this}clamp(t,e){return this.x=Math.max(t.x,Math.min(e.x,this.x)),this.y=Math.max(t.y,Math.min(e.y,this.y)),this}clampScalar(t,e){return this.x=Math.max(t,Math.min(e,this.x)),this.y=Math.max(t,Math.min(e,this.y)),this}clampLength(t,e){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(t,Math.min(e,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(t){return this.x*t.x+this.y*t.y}cross(t){return this.x*t.y-this.y*t.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(t){const e=Math.sqrt(this.lengthSq()*t.lengthSq());if(e===0)return Math.PI/2;const n=this.dot(t)/e;return Math.acos($e(n,-1,1))}distanceTo(t){return Math.sqrt(this.distanceToSquared(t))}distanceToSquared(t){const e=this.x-t.x,n=this.y-t.y;return e*e+n*n}manhattanDistanceTo(t){return Math.abs(this.x-t.x)+Math.abs(this.y-t.y)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this}lerpVectors(t,e,n){return this.x=t.x+(e.x-t.x)*n,this.y=t.y+(e.y-t.y)*n,this}equals(t){return t.x===this.x&&t.y===this.y}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this}rotateAround(t,e){const n=Math.cos(e),s=Math.sin(e),r=this.x-t.x,o=this.y-t.y;return this.x=r*n-o*s+t.x,this.y=r*s+o*n+t.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}}class Jt{constructor(t,e,n,s,r,o,a,c,l){Jt.prototype.isMatrix3=!0,this.elements=[1,0,0,0,1,0,0,0,1],t!==void 0&&this.set(t,e,n,s,r,o,a,c,l)}set(t,e,n,s,r,o,a,c,l){const h=this.elements;return h[0]=t,h[1]=s,h[2]=a,h[3]=e,h[4]=r,h[5]=c,h[6]=n,h[7]=o,h[8]=l,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(t){const e=this.elements,n=t.elements;return e[0]=n[0],e[1]=n[1],e[2]=n[2],e[3]=n[3],e[4]=n[4],e[5]=n[5],e[6]=n[6],e[7]=n[7],e[8]=n[8],this}extractBasis(t,e,n){return t.setFromMatrix3Column(this,0),e.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(t){const e=t.elements;return this.set(e[0],e[4],e[8],e[1],e[5],e[9],e[2],e[6],e[10]),this}multiply(t){return this.multiplyMatrices(this,t)}premultiply(t){return this.multiplyMatrices(t,this)}multiplyMatrices(t,e){const n=t.elements,s=e.elements,r=this.elements,o=n[0],a=n[3],c=n[6],l=n[1],h=n[4],d=n[7],f=n[2],p=n[5],v=n[8],x=s[0],m=s[3],_=s[6],A=s[1],S=s[4],b=s[7],F=s[2],N=s[5],M=s[8];return r[0]=o*x+a*A+c*F,r[3]=o*m+a*S+c*N,r[6]=o*_+a*b+c*M,r[1]=l*x+h*A+d*F,r[4]=l*m+h*S+d*N,r[7]=l*_+h*b+d*M,r[2]=f*x+p*A+v*F,r[5]=f*m+p*S+v*N,r[8]=f*_+p*b+v*M,this}multiplyScalar(t){const e=this.elements;return e[0]*=t,e[3]*=t,e[6]*=t,e[1]*=t,e[4]*=t,e[7]*=t,e[2]*=t,e[5]*=t,e[8]*=t,this}determinant(){const t=this.elements,e=t[0],n=t[1],s=t[2],r=t[3],o=t[4],a=t[5],c=t[6],l=t[7],h=t[8];return e*o*h-e*a*l-n*r*h+n*a*c+s*r*l-s*o*c}invert(){const t=this.elements,e=t[0],n=t[1],s=t[2],r=t[3],o=t[4],a=t[5],c=t[6],l=t[7],h=t[8],d=h*o-a*l,f=a*c-h*r,p=l*r-o*c,v=e*d+n*f+s*p;if(v===0)return this.set(0,0,0,0,0,0,0,0,0);const x=1/v;return t[0]=d*x,t[1]=(s*l-h*n)*x,t[2]=(a*n-s*o)*x,t[3]=f*x,t[4]=(h*e-s*c)*x,t[5]=(s*r-a*e)*x,t[6]=p*x,t[7]=(n*c-l*e)*x,t[8]=(o*e-n*r)*x,this}transpose(){let t;const e=this.elements;return t=e[1],e[1]=e[3],e[3]=t,t=e[2],e[2]=e[6],e[6]=t,t=e[5],e[5]=e[7],e[7]=t,this}getNormalMatrix(t){return this.setFromMatrix4(t).invert().transpose()}transposeIntoArray(t){const e=this.elements;return t[0]=e[0],t[1]=e[3],t[2]=e[6],t[3]=e[1],t[4]=e[4],t[5]=e[7],t[6]=e[2],t[7]=e[5],t[8]=e[8],this}setUvTransform(t,e,n,s,r,o,a){const c=Math.cos(r),l=Math.sin(r);return this.set(n*c,n*l,-n*(c*o+l*a)+o+t,-s*l,s*c,-s*(-l*o+c*a)+a+e,0,0,1),this}scale(t,e){return this.premultiply(Jl.makeScale(t,e)),this}rotate(t){return this.premultiply(Jl.makeRotation(-t)),this}translate(t,e){return this.premultiply(Jl.makeTranslation(t,e)),this}makeTranslation(t,e){return t.isVector2?this.set(1,0,t.x,0,1,t.y,0,0,1):this.set(1,0,t,0,1,e,0,0,1),this}makeRotation(t){const e=Math.cos(t),n=Math.sin(t);return this.set(e,-n,0,n,e,0,0,0,1),this}makeScale(t,e){return this.set(t,0,0,0,e,0,0,0,1),this}equals(t){const e=this.elements,n=t.elements;for(let s=0;s<9;s++)if(e[s]!==n[s])return!1;return!0}fromArray(t,e=0){for(let n=0;n<9;n++)this.elements[n]=t[n+e];return this}toArray(t=[],e=0){const n=this.elements;return t[e]=n[0],t[e+1]=n[1],t[e+2]=n[2],t[e+3]=n[3],t[e+4]=n[4],t[e+5]=n[5],t[e+6]=n[6],t[e+7]=n[7],t[e+8]=n[8],t}clone(){return new this.constructor().fromArray(this.elements)}}const Jl=new Jt;function l_(i){for(let t=i.length-1;t>=0;--t)if(i[t]>=65535)return!0;return!1}function da(i){return document.createElementNS("http://www.w3.org/1999/xhtml",i)}function Sx(){const i=da("canvas");return i.style.display="block",i}const op={};function kc(i){i in op||(op[i]=!0,console.warn(i))}function Ax(i,t,e){return new Promise(function(n,s){function r(){switch(i.clientWaitSync(t,i.SYNC_FLUSH_COMMANDS_BIT,0)){case i.WAIT_FAILED:s();break;case i.TIMEOUT_EXPIRED:setTimeout(r,e);break;default:n()}}setTimeout(r,e)})}function Mx(i){const t=i.elements;t[2]=.5*t[2]+.5*t[3],t[6]=.5*t[6]+.5*t[7],t[10]=.5*t[10]+.5*t[11],t[14]=.5*t[14]+.5*t[15]}function wx(i){const t=i.elements;t[11]===-1?(t[10]=-t[10]-1,t[14]=-t[14]):(t[10]=-t[10],t[14]=-t[14]+1)}const ap=new Jt().set(.8224621,.177538,0,.0331941,.9668058,0,.0170827,.0723974,.9105199),cp=new Jt().set(1.2249401,-.2249404,0,-.0420569,1.0420571,0,-.0196376,-.0786361,1.0982735),Co={[fn]:{transfer:Zc,primaries:Qc,luminanceCoefficients:[.2126,.7152,.0722],toReference:i=>i,fromReference:i=>i},[hn]:{transfer:Ie,primaries:Qc,luminanceCoefficients:[.2126,.7152,.0722],toReference:i=>i.convertSRGBToLinear(),fromReference:i=>i.convertLinearToSRGB()},[Ml]:{transfer:Zc,primaries:tl,luminanceCoefficients:[.2289,.6917,.0793],toReference:i=>i.applyMatrix3(cp),fromReference:i=>i.applyMatrix3(ap)},[Md]:{transfer:Ie,primaries:tl,luminanceCoefficients:[.2289,.6917,.0793],toReference:i=>i.convertSRGBToLinear().applyMatrix3(cp),fromReference:i=>i.applyMatrix3(ap).convertLinearToSRGB()}},bx=new Set([fn,Ml]),me={enabled:!0,_workingColorSpace:fn,get workingColorSpace(){return this._workingColorSpace},set workingColorSpace(i){if(!bx.has(i))throw new Error(`Unsupported working color space, "${i}".`);this._workingColorSpace=i},convert:function(i,t,e){if(this.enabled===!1||t===e||!t||!e)return i;const n=Co[t].toReference,s=Co[e].fromReference;return s(n(i))},fromWorkingColorSpace:function(i,t){return this.convert(i,this._workingColorSpace,t)},toWorkingColorSpace:function(i,t){return this.convert(i,t,this._workingColorSpace)},getPrimaries:function(i){return Co[i].primaries},getTransfer:function(i){return i===ns?Zc:Co[i].transfer},getLuminanceCoefficients:function(i,t=this._workingColorSpace){return i.fromArray(Co[t].luminanceCoefficients)}};function zr(i){return i<.04045?i*.0773993808:Math.pow(i*.9478672986+.0521327014,2.4)}function Zl(i){return i<.0031308?i*12.92:1.055*Math.pow(i,.41666)-.055}let dr;class Rx{static getDataURL(t){if(/^data:/i.test(t.src)||typeof HTMLCanvasElement>"u")return t.src;let e;if(t instanceof HTMLCanvasElement)e=t;else{dr===void 0&&(dr=da("canvas")),dr.width=t.width,dr.height=t.height;const n=dr.getContext("2d");t instanceof ImageData?n.putImageData(t,0,0):n.drawImage(t,0,0,t.width,t.height),e=dr}return e.width>2048||e.height>2048?(console.warn("THREE.ImageUtils.getDataURL: Image converted to jpg for performance reasons",t),e.toDataURL("image/jpeg",.6)):e.toDataURL("image/png")}static sRGBToLinear(t){if(typeof HTMLImageElement<"u"&&t instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&t instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&t instanceof ImageBitmap){const e=da("canvas");e.width=t.width,e.height=t.height;const n=e.getContext("2d");n.drawImage(t,0,0,t.width,t.height);const s=n.getImageData(0,0,t.width,t.height),r=s.data;for(let o=0;o<r.length;o++)r[o]=zr(r[o]/255)*255;return n.putImageData(s,0,0),e}else if(t.data){const e=t.data.slice(0);for(let n=0;n<e.length;n++)e instanceof Uint8Array||e instanceof Uint8ClampedArray?e[n]=Math.floor(zr(e[n]/255)*255):e[n]=zr(e[n]);return{data:e,width:t.width,height:t.height}}else return console.warn("THREE.ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),t}}let Ix=0;class u_{constructor(t=null){this.isSource=!0,Object.defineProperty(this,"id",{value:Ix++}),this.uuid=qn(),this.data=t,this.dataReady=!0,this.version=0}set needsUpdate(t){t===!0&&this.version++}toJSON(t){const e=t===void 0||typeof t=="string";if(!e&&t.images[this.uuid]!==void 0)return t.images[this.uuid];const n={uuid:this.uuid,url:""},s=this.data;if(s!==null){let r;if(Array.isArray(s)){r=[];for(let o=0,a=s.length;o<a;o++)s[o].isDataTexture?r.push(Ql(s[o].image)):r.push(Ql(s[o]))}else r=Ql(s);n.url=r}return e||(t.images[this.uuid]=n),n}}function Ql(i){return typeof HTMLImageElement<"u"&&i instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&i instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&i instanceof ImageBitmap?Rx.getDataURL(i):i.data?{data:Array.from(i.data),width:i.width,height:i.height,type:i.data.constructor.name}:(console.warn("THREE.Texture: Unable to serialize Texture."),{})}let Cx=0;class Ze extends Ms{constructor(t=Ze.DEFAULT_IMAGE,e=Ze.DEFAULT_MAPPING,n=ss,s=ss,r=Fn,o=Fi,a=Xn,c=ki,l=Ze.DEFAULT_ANISOTROPY,h=ns){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:Cx++}),this.uuid=qn(),this.name="",this.source=new u_(t),this.mipmaps=[],this.mapping=e,this.channel=0,this.wrapS=n,this.wrapT=s,this.magFilter=r,this.minFilter=o,this.anisotropy=l,this.format=a,this.internalFormat=null,this.type=c,this.offset=new dt(0,0),this.repeat=new dt(1,1),this.center=new dt(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new Jt,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=h,this.userData={},this.version=0,this.onUpdate=null,this.isRenderTargetTexture=!1,this.pmremVersion=0}get image(){return this.source.data}set image(t=null){this.source.data=t}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}clone(){return new this.constructor().copy(this)}copy(t){return this.name=t.name,this.source=t.source,this.mipmaps=t.mipmaps.slice(0),this.mapping=t.mapping,this.channel=t.channel,this.wrapS=t.wrapS,this.wrapT=t.wrapT,this.magFilter=t.magFilter,this.minFilter=t.minFilter,this.anisotropy=t.anisotropy,this.format=t.format,this.internalFormat=t.internalFormat,this.type=t.type,this.offset.copy(t.offset),this.repeat.copy(t.repeat),this.center.copy(t.center),this.rotation=t.rotation,this.matrixAutoUpdate=t.matrixAutoUpdate,this.matrix.copy(t.matrix),this.generateMipmaps=t.generateMipmaps,this.premultiplyAlpha=t.premultiplyAlpha,this.flipY=t.flipY,this.unpackAlignment=t.unpackAlignment,this.colorSpace=t.colorSpace,this.userData=JSON.parse(JSON.stringify(t.userData)),this.needsUpdate=!0,this}toJSON(t){const e=t===void 0||typeof t=="string";if(!e&&t.textures[this.uuid]!==void 0)return t.textures[this.uuid];const n={metadata:{version:4.6,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(t).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(n.userData=this.userData),e||(t.textures[this.uuid]=n),n}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(t){if(this.mapping!==Yg)return t;if(t.applyMatrix3(this.matrix),t.x<0||t.x>1)switch(this.wrapS){case Ks:t.x=t.x-Math.floor(t.x);break;case ss:t.x=t.x<0?0:1;break;case Yc:Math.abs(Math.floor(t.x)%2)===1?t.x=Math.ceil(t.x)-t.x:t.x=t.x-Math.floor(t.x);break}if(t.y<0||t.y>1)switch(this.wrapT){case Ks:t.y=t.y-Math.floor(t.y);break;case ss:t.y=t.y<0?0:1;break;case Yc:Math.abs(Math.floor(t.y)%2)===1?t.y=Math.ceil(t.y)-t.y:t.y=t.y-Math.floor(t.y);break}return this.flipY&&(t.y=1-t.y),t}set needsUpdate(t){t===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(t){t===!0&&this.pmremVersion++}}Ze.DEFAULT_IMAGE=null;Ze.DEFAULT_MAPPING=Yg;Ze.DEFAULT_ANISOTROPY=1;class ge{constructor(t=0,e=0,n=0,s=1){ge.prototype.isVector4=!0,this.x=t,this.y=e,this.z=n,this.w=s}get width(){return this.z}set width(t){this.z=t}get height(){return this.w}set height(t){this.w=t}set(t,e,n,s){return this.x=t,this.y=e,this.z=n,this.w=s,this}setScalar(t){return this.x=t,this.y=t,this.z=t,this.w=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setZ(t){return this.z=t,this}setW(t){return this.w=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;case 2:this.z=e;break;case 3:this.w=e;break;default:throw new Error("index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(t){return this.x=t.x,this.y=t.y,this.z=t.z,this.w=t.w!==void 0?t.w:1,this}add(t){return this.x+=t.x,this.y+=t.y,this.z+=t.z,this.w+=t.w,this}addScalar(t){return this.x+=t,this.y+=t,this.z+=t,this.w+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this.z=t.z+e.z,this.w=t.w+e.w,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this.z+=t.z*e,this.w+=t.w*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this.z-=t.z,this.w-=t.w,this}subScalar(t){return this.x-=t,this.y-=t,this.z-=t,this.w-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this.z=t.z-e.z,this.w=t.w-e.w,this}multiply(t){return this.x*=t.x,this.y*=t.y,this.z*=t.z,this.w*=t.w,this}multiplyScalar(t){return this.x*=t,this.y*=t,this.z*=t,this.w*=t,this}applyMatrix4(t){const e=this.x,n=this.y,s=this.z,r=this.w,o=t.elements;return this.x=o[0]*e+o[4]*n+o[8]*s+o[12]*r,this.y=o[1]*e+o[5]*n+o[9]*s+o[13]*r,this.z=o[2]*e+o[6]*n+o[10]*s+o[14]*r,this.w=o[3]*e+o[7]*n+o[11]*s+o[15]*r,this}divideScalar(t){return this.multiplyScalar(1/t)}setAxisAngleFromQuaternion(t){this.w=2*Math.acos(t.w);const e=Math.sqrt(1-t.w*t.w);return e<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=t.x/e,this.y=t.y/e,this.z=t.z/e),this}setAxisAngleFromRotationMatrix(t){let e,n,s,r;const c=t.elements,l=c[0],h=c[4],d=c[8],f=c[1],p=c[5],v=c[9],x=c[2],m=c[6],_=c[10];if(Math.abs(h-f)<.01&&Math.abs(d-x)<.01&&Math.abs(v-m)<.01){if(Math.abs(h+f)<.1&&Math.abs(d+x)<.1&&Math.abs(v+m)<.1&&Math.abs(l+p+_-3)<.1)return this.set(1,0,0,0),this;e=Math.PI;const S=(l+1)/2,b=(p+1)/2,F=(_+1)/2,N=(h+f)/4,M=(d+x)/4,w=(v+m)/4;return S>b&&S>F?S<.01?(n=0,s=.707106781,r=.707106781):(n=Math.sqrt(S),s=N/n,r=M/n):b>F?b<.01?(n=.707106781,s=0,r=.707106781):(s=Math.sqrt(b),n=N/s,r=w/s):F<.01?(n=.707106781,s=.707106781,r=0):(r=Math.sqrt(F),n=M/r,s=w/r),this.set(n,s,r,e),this}let A=Math.sqrt((m-v)*(m-v)+(d-x)*(d-x)+(f-h)*(f-h));return Math.abs(A)<.001&&(A=1),this.x=(m-v)/A,this.y=(d-x)/A,this.z=(f-h)/A,this.w=Math.acos((l+p+_-1)/2),this}setFromMatrixPosition(t){const e=t.elements;return this.x=e[12],this.y=e[13],this.z=e[14],this.w=e[15],this}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this.z=Math.min(this.z,t.z),this.w=Math.min(this.w,t.w),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this.z=Math.max(this.z,t.z),this.w=Math.max(this.w,t.w),this}clamp(t,e){return this.x=Math.max(t.x,Math.min(e.x,this.x)),this.y=Math.max(t.y,Math.min(e.y,this.y)),this.z=Math.max(t.z,Math.min(e.z,this.z)),this.w=Math.max(t.w,Math.min(e.w,this.w)),this}clampScalar(t,e){return this.x=Math.max(t,Math.min(e,this.x)),this.y=Math.max(t,Math.min(e,this.y)),this.z=Math.max(t,Math.min(e,this.z)),this.w=Math.max(t,Math.min(e,this.w)),this}clampLength(t,e){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(t,Math.min(e,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(t){return this.x*t.x+this.y*t.y+this.z*t.z+this.w*t.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this.z+=(t.z-this.z)*e,this.w+=(t.w-this.w)*e,this}lerpVectors(t,e,n){return this.x=t.x+(e.x-t.x)*n,this.y=t.y+(e.y-t.y)*n,this.z=t.z+(e.z-t.z)*n,this.w=t.w+(e.w-t.w)*n,this}equals(t){return t.x===this.x&&t.y===this.y&&t.z===this.z&&t.w===this.w}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this.z=t[e+2],this.w=t[e+3],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t[e+2]=this.z,t[e+3]=this.w,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this.z=t.getZ(e),this.w=t.getW(e),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}}class Px extends Ms{constructor(t=1,e=1,n={}){super(),this.isRenderTarget=!0,this.width=t,this.height=e,this.depth=1,this.scissor=new ge(0,0,t,e),this.scissorTest=!1,this.viewport=new ge(0,0,t,e);const s={width:t,height:e,depth:1};n=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:Fn,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1},n);const r=new Ze(s,n.mapping,n.wrapS,n.wrapT,n.magFilter,n.minFilter,n.format,n.type,n.anisotropy,n.colorSpace);r.flipY=!1,r.generateMipmaps=n.generateMipmaps,r.internalFormat=n.internalFormat,this.textures=[];const o=n.count;for(let a=0;a<o;a++)this.textures[a]=r.clone(),this.textures[a].isRenderTargetTexture=!0;this.depthBuffer=n.depthBuffer,this.stencilBuffer=n.stencilBuffer,this.resolveDepthBuffer=n.resolveDepthBuffer,this.resolveStencilBuffer=n.resolveStencilBuffer,this.depthTexture=n.depthTexture,this.samples=n.samples}get texture(){return this.textures[0]}set texture(t){this.textures[0]=t}setSize(t,e,n=1){if(this.width!==t||this.height!==e||this.depth!==n){this.width=t,this.height=e,this.depth=n;for(let s=0,r=this.textures.length;s<r;s++)this.textures[s].image.width=t,this.textures[s].image.height=e,this.textures[s].image.depth=n;this.dispose()}this.viewport.set(0,0,t,e),this.scissor.set(0,0,t,e)}clone(){return new this.constructor().copy(this)}copy(t){this.width=t.width,this.height=t.height,this.depth=t.depth,this.scissor.copy(t.scissor),this.scissorTest=t.scissorTest,this.viewport.copy(t.viewport),this.textures.length=0;for(let n=0,s=t.textures.length;n<s;n++)this.textures[n]=t.textures[n].clone(),this.textures[n].isRenderTargetTexture=!0;const e=Object.assign({},t.texture.image);return this.texture.source=new u_(e),this.depthBuffer=t.depthBuffer,this.stencilBuffer=t.stencilBuffer,this.resolveDepthBuffer=t.resolveDepthBuffer,this.resolveStencilBuffer=t.resolveStencilBuffer,t.depthTexture!==null&&(this.depthTexture=t.depthTexture.clone()),this.samples=t.samples,this}dispose(){this.dispatchEvent({type:"dispose"})}}class Ys extends Px{constructor(t=1,e=1,n={}){super(t,e,n),this.isWebGLRenderTarget=!0}}class h_ extends Ze{constructor(t=null,e=1,n=1,s=1){super(null),this.isDataArrayTexture=!0,this.image={data:t,width:e,height:n,depth:s},this.magFilter=Rn,this.minFilter=Rn,this.wrapR=ss,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(t){this.layerUpdates.add(t)}clearLayerUpdates(){this.layerUpdates.clear()}}class Dx extends Ze{constructor(t=null,e=1,n=1,s=1){super(null),this.isData3DTexture=!0,this.image={data:t,width:e,height:n,depth:s},this.magFilter=Rn,this.minFilter=Rn,this.wrapR=ss,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}class oi{constructor(t=0,e=0,n=0,s=1){this.isQuaternion=!0,this._x=t,this._y=e,this._z=n,this._w=s}static slerpFlat(t,e,n,s,r,o,a){let c=n[s+0],l=n[s+1],h=n[s+2],d=n[s+3];const f=r[o+0],p=r[o+1],v=r[o+2],x=r[o+3];if(a===0){t[e+0]=c,t[e+1]=l,t[e+2]=h,t[e+3]=d;return}if(a===1){t[e+0]=f,t[e+1]=p,t[e+2]=v,t[e+3]=x;return}if(d!==x||c!==f||l!==p||h!==v){let m=1-a;const _=c*f+l*p+h*v+d*x,A=_>=0?1:-1,S=1-_*_;if(S>Number.EPSILON){const F=Math.sqrt(S),N=Math.atan2(F,_*A);m=Math.sin(m*N)/F,a=Math.sin(a*N)/F}const b=a*A;if(c=c*m+f*b,l=l*m+p*b,h=h*m+v*b,d=d*m+x*b,m===1-a){const F=1/Math.sqrt(c*c+l*l+h*h+d*d);c*=F,l*=F,h*=F,d*=F}}t[e]=c,t[e+1]=l,t[e+2]=h,t[e+3]=d}static multiplyQuaternionsFlat(t,e,n,s,r,o){const a=n[s],c=n[s+1],l=n[s+2],h=n[s+3],d=r[o],f=r[o+1],p=r[o+2],v=r[o+3];return t[e]=a*v+h*d+c*p-l*f,t[e+1]=c*v+h*f+l*d-a*p,t[e+2]=l*v+h*p+a*f-c*d,t[e+3]=h*v-a*d-c*f-l*p,t}get x(){return this._x}set x(t){this._x=t,this._onChangeCallback()}get y(){return this._y}set y(t){this._y=t,this._onChangeCallback()}get z(){return this._z}set z(t){this._z=t,this._onChangeCallback()}get w(){return this._w}set w(t){this._w=t,this._onChangeCallback()}set(t,e,n,s){return this._x=t,this._y=e,this._z=n,this._w=s,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(t){return this._x=t.x,this._y=t.y,this._z=t.z,this._w=t.w,this._onChangeCallback(),this}setFromEuler(t,e=!0){const n=t._x,s=t._y,r=t._z,o=t._order,a=Math.cos,c=Math.sin,l=a(n/2),h=a(s/2),d=a(r/2),f=c(n/2),p=c(s/2),v=c(r/2);switch(o){case"XYZ":this._x=f*h*d+l*p*v,this._y=l*p*d-f*h*v,this._z=l*h*v+f*p*d,this._w=l*h*d-f*p*v;break;case"YXZ":this._x=f*h*d+l*p*v,this._y=l*p*d-f*h*v,this._z=l*h*v-f*p*d,this._w=l*h*d+f*p*v;break;case"ZXY":this._x=f*h*d-l*p*v,this._y=l*p*d+f*h*v,this._z=l*h*v+f*p*d,this._w=l*h*d-f*p*v;break;case"ZYX":this._x=f*h*d-l*p*v,this._y=l*p*d+f*h*v,this._z=l*h*v-f*p*d,this._w=l*h*d+f*p*v;break;case"YZX":this._x=f*h*d+l*p*v,this._y=l*p*d+f*h*v,this._z=l*h*v-f*p*d,this._w=l*h*d-f*p*v;break;case"XZY":this._x=f*h*d-l*p*v,this._y=l*p*d-f*h*v,this._z=l*h*v+f*p*d,this._w=l*h*d+f*p*v;break;default:console.warn("THREE.Quaternion: .setFromEuler() encountered an unknown order: "+o)}return e===!0&&this._onChangeCallback(),this}setFromAxisAngle(t,e){const n=e/2,s=Math.sin(n);return this._x=t.x*s,this._y=t.y*s,this._z=t.z*s,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(t){const e=t.elements,n=e[0],s=e[4],r=e[8],o=e[1],a=e[5],c=e[9],l=e[2],h=e[6],d=e[10],f=n+a+d;if(f>0){const p=.5/Math.sqrt(f+1);this._w=.25/p,this._x=(h-c)*p,this._y=(r-l)*p,this._z=(o-s)*p}else if(n>a&&n>d){const p=2*Math.sqrt(1+n-a-d);this._w=(h-c)/p,this._x=.25*p,this._y=(s+o)/p,this._z=(r+l)/p}else if(a>d){const p=2*Math.sqrt(1+a-n-d);this._w=(r-l)/p,this._x=(s+o)/p,this._y=.25*p,this._z=(c+h)/p}else{const p=2*Math.sqrt(1+d-n-a);this._w=(o-s)/p,this._x=(r+l)/p,this._y=(c+h)/p,this._z=.25*p}return this._onChangeCallback(),this}setFromUnitVectors(t,e){let n=t.dot(e)+1;return n<Number.EPSILON?(n=0,Math.abs(t.x)>Math.abs(t.z)?(this._x=-t.y,this._y=t.x,this._z=0,this._w=n):(this._x=0,this._y=-t.z,this._z=t.y,this._w=n)):(this._x=t.y*e.z-t.z*e.y,this._y=t.z*e.x-t.x*e.z,this._z=t.x*e.y-t.y*e.x,this._w=n),this.normalize()}angleTo(t){return 2*Math.acos(Math.abs($e(this.dot(t),-1,1)))}rotateTowards(t,e){const n=this.angleTo(t);if(n===0)return this;const s=Math.min(1,e/n);return this.slerp(t,s),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(t){return this._x*t._x+this._y*t._y+this._z*t._z+this._w*t._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let t=this.length();return t===0?(this._x=0,this._y=0,this._z=0,this._w=1):(t=1/t,this._x=this._x*t,this._y=this._y*t,this._z=this._z*t,this._w=this._w*t),this._onChangeCallback(),this}multiply(t){return this.multiplyQuaternions(this,t)}premultiply(t){return this.multiplyQuaternions(t,this)}multiplyQuaternions(t,e){const n=t._x,s=t._y,r=t._z,o=t._w,a=e._x,c=e._y,l=e._z,h=e._w;return this._x=n*h+o*a+s*l-r*c,this._y=s*h+o*c+r*a-n*l,this._z=r*h+o*l+n*c-s*a,this._w=o*h-n*a-s*c-r*l,this._onChangeCallback(),this}slerp(t,e){if(e===0)return this;if(e===1)return this.copy(t);const n=this._x,s=this._y,r=this._z,o=this._w;let a=o*t._w+n*t._x+s*t._y+r*t._z;if(a<0?(this._w=-t._w,this._x=-t._x,this._y=-t._y,this._z=-t._z,a=-a):this.copy(t),a>=1)return this._w=o,this._x=n,this._y=s,this._z=r,this;const c=1-a*a;if(c<=Number.EPSILON){const p=1-e;return this._w=p*o+e*this._w,this._x=p*n+e*this._x,this._y=p*s+e*this._y,this._z=p*r+e*this._z,this.normalize(),this}const l=Math.sqrt(c),h=Math.atan2(l,a),d=Math.sin((1-e)*h)/l,f=Math.sin(e*h)/l;return this._w=o*d+this._w*f,this._x=n*d+this._x*f,this._y=s*d+this._y*f,this._z=r*d+this._z*f,this._onChangeCallback(),this}slerpQuaternions(t,e,n){return this.copy(t).slerp(e,n)}random(){const t=2*Math.PI*Math.random(),e=2*Math.PI*Math.random(),n=Math.random(),s=Math.sqrt(1-n),r=Math.sqrt(n);return this.set(s*Math.sin(t),s*Math.cos(t),r*Math.sin(e),r*Math.cos(e))}equals(t){return t._x===this._x&&t._y===this._y&&t._z===this._z&&t._w===this._w}fromArray(t,e=0){return this._x=t[e],this._y=t[e+1],this._z=t[e+2],this._w=t[e+3],this._onChangeCallback(),this}toArray(t=[],e=0){return t[e]=this._x,t[e+1]=this._y,t[e+2]=this._z,t[e+3]=this._w,t}fromBufferAttribute(t,e){return this._x=t.getX(e),this._y=t.getY(e),this._z=t.getZ(e),this._w=t.getW(e),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(t){return this._onChangeCallback=t,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}}class O{constructor(t=0,e=0,n=0){O.prototype.isVector3=!0,this.x=t,this.y=e,this.z=n}set(t,e,n){return n===void 0&&(n=this.z),this.x=t,this.y=e,this.z=n,this}setScalar(t){return this.x=t,this.y=t,this.z=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setZ(t){return this.z=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;case 2:this.z=e;break;default:throw new Error("index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(t){return this.x=t.x,this.y=t.y,this.z=t.z,this}add(t){return this.x+=t.x,this.y+=t.y,this.z+=t.z,this}addScalar(t){return this.x+=t,this.y+=t,this.z+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this.z=t.z+e.z,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this.z+=t.z*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this.z-=t.z,this}subScalar(t){return this.x-=t,this.y-=t,this.z-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this.z=t.z-e.z,this}multiply(t){return this.x*=t.x,this.y*=t.y,this.z*=t.z,this}multiplyScalar(t){return this.x*=t,this.y*=t,this.z*=t,this}multiplyVectors(t,e){return this.x=t.x*e.x,this.y=t.y*e.y,this.z=t.z*e.z,this}applyEuler(t){return this.applyQuaternion(lp.setFromEuler(t))}applyAxisAngle(t,e){return this.applyQuaternion(lp.setFromAxisAngle(t,e))}applyMatrix3(t){const e=this.x,n=this.y,s=this.z,r=t.elements;return this.x=r[0]*e+r[3]*n+r[6]*s,this.y=r[1]*e+r[4]*n+r[7]*s,this.z=r[2]*e+r[5]*n+r[8]*s,this}applyNormalMatrix(t){return this.applyMatrix3(t).normalize()}applyMatrix4(t){const e=this.x,n=this.y,s=this.z,r=t.elements,o=1/(r[3]*e+r[7]*n+r[11]*s+r[15]);return this.x=(r[0]*e+r[4]*n+r[8]*s+r[12])*o,this.y=(r[1]*e+r[5]*n+r[9]*s+r[13])*o,this.z=(r[2]*e+r[6]*n+r[10]*s+r[14])*o,this}applyQuaternion(t){const e=this.x,n=this.y,s=this.z,r=t.x,o=t.y,a=t.z,c=t.w,l=2*(o*s-a*n),h=2*(a*e-r*s),d=2*(r*n-o*e);return this.x=e+c*l+o*d-a*h,this.y=n+c*h+a*l-r*d,this.z=s+c*d+r*h-o*l,this}project(t){return this.applyMatrix4(t.matrixWorldInverse).applyMatrix4(t.projectionMatrix)}unproject(t){return this.applyMatrix4(t.projectionMatrixInverse).applyMatrix4(t.matrixWorld)}transformDirection(t){const e=this.x,n=this.y,s=this.z,r=t.elements;return this.x=r[0]*e+r[4]*n+r[8]*s,this.y=r[1]*e+r[5]*n+r[9]*s,this.z=r[2]*e+r[6]*n+r[10]*s,this.normalize()}divide(t){return this.x/=t.x,this.y/=t.y,this.z/=t.z,this}divideScalar(t){return this.multiplyScalar(1/t)}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this.z=Math.min(this.z,t.z),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this.z=Math.max(this.z,t.z),this}clamp(t,e){return this.x=Math.max(t.x,Math.min(e.x,this.x)),this.y=Math.max(t.y,Math.min(e.y,this.y)),this.z=Math.max(t.z,Math.min(e.z,this.z)),this}clampScalar(t,e){return this.x=Math.max(t,Math.min(e,this.x)),this.y=Math.max(t,Math.min(e,this.y)),this.z=Math.max(t,Math.min(e,this.z)),this}clampLength(t,e){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(t,Math.min(e,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(t){return this.x*t.x+this.y*t.y+this.z*t.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this.z+=(t.z-this.z)*e,this}lerpVectors(t,e,n){return this.x=t.x+(e.x-t.x)*n,this.y=t.y+(e.y-t.y)*n,this.z=t.z+(e.z-t.z)*n,this}cross(t){return this.crossVectors(this,t)}crossVectors(t,e){const n=t.x,s=t.y,r=t.z,o=e.x,a=e.y,c=e.z;return this.x=s*c-r*a,this.y=r*o-n*c,this.z=n*a-s*o,this}projectOnVector(t){const e=t.lengthSq();if(e===0)return this.set(0,0,0);const n=t.dot(this)/e;return this.copy(t).multiplyScalar(n)}projectOnPlane(t){return tu.copy(this).projectOnVector(t),this.sub(tu)}reflect(t){return this.sub(tu.copy(t).multiplyScalar(2*this.dot(t)))}angleTo(t){const e=Math.sqrt(this.lengthSq()*t.lengthSq());if(e===0)return Math.PI/2;const n=this.dot(t)/e;return Math.acos($e(n,-1,1))}distanceTo(t){return Math.sqrt(this.distanceToSquared(t))}distanceToSquared(t){const e=this.x-t.x,n=this.y-t.y,s=this.z-t.z;return e*e+n*n+s*s}manhattanDistanceTo(t){return Math.abs(this.x-t.x)+Math.abs(this.y-t.y)+Math.abs(this.z-t.z)}setFromSpherical(t){return this.setFromSphericalCoords(t.radius,t.phi,t.theta)}setFromSphericalCoords(t,e,n){const s=Math.sin(e)*t;return this.x=s*Math.sin(n),this.y=Math.cos(e)*t,this.z=s*Math.cos(n),this}setFromCylindrical(t){return this.setFromCylindricalCoords(t.radius,t.theta,t.y)}setFromCylindricalCoords(t,e,n){return this.x=t*Math.sin(e),this.y=n,this.z=t*Math.cos(e),this}setFromMatrixPosition(t){const e=t.elements;return this.x=e[12],this.y=e[13],this.z=e[14],this}setFromMatrixScale(t){const e=this.setFromMatrixColumn(t,0).length(),n=this.setFromMatrixColumn(t,1).length(),s=this.setFromMatrixColumn(t,2).length();return this.x=e,this.y=n,this.z=s,this}setFromMatrixColumn(t,e){return this.fromArray(t.elements,e*4)}setFromMatrix3Column(t,e){return this.fromArray(t.elements,e*3)}setFromEuler(t){return this.x=t._x,this.y=t._y,this.z=t._z,this}setFromColor(t){return this.x=t.r,this.y=t.g,this.z=t.b,this}equals(t){return t.x===this.x&&t.y===this.y&&t.z===this.z}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this.z=t[e+2],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t[e+2]=this.z,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this.z=t.getZ(e),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){const t=Math.random()*Math.PI*2,e=Math.random()*2-1,n=Math.sqrt(1-e*e);return this.x=n*Math.cos(t),this.y=e,this.z=n*Math.sin(t),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}}const tu=new O,lp=new oi;class Ti{constructor(t=new O(1/0,1/0,1/0),e=new O(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=t,this.max=e}set(t,e){return this.min.copy(t),this.max.copy(e),this}setFromArray(t){this.makeEmpty();for(let e=0,n=t.length;e<n;e+=3)this.expandByPoint(Jn.fromArray(t,e));return this}setFromBufferAttribute(t){this.makeEmpty();for(let e=0,n=t.count;e<n;e++)this.expandByPoint(Jn.fromBufferAttribute(t,e));return this}setFromPoints(t){this.makeEmpty();for(let e=0,n=t.length;e<n;e++)this.expandByPoint(t[e]);return this}setFromCenterAndSize(t,e){const n=Jn.copy(e).multiplyScalar(.5);return this.min.copy(t).sub(n),this.max.copy(t).add(n),this}setFromObject(t,e=!1){return this.makeEmpty(),this.expandByObject(t,e)}clone(){return new this.constructor().copy(this)}copy(t){return this.min.copy(t.min),this.max.copy(t.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(t){return this.isEmpty()?t.set(0,0,0):t.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(t){return this.isEmpty()?t.set(0,0,0):t.subVectors(this.max,this.min)}expandByPoint(t){return this.min.min(t),this.max.max(t),this}expandByVector(t){return this.min.sub(t),this.max.add(t),this}expandByScalar(t){return this.min.addScalar(-t),this.max.addScalar(t),this}expandByObject(t,e=!1){t.updateWorldMatrix(!1,!1);const n=t.geometry;if(n!==void 0){const r=n.getAttribute("position");if(e===!0&&r!==void 0&&t.isInstancedMesh!==!0)for(let o=0,a=r.count;o<a;o++)t.isMesh===!0?t.getVertexPosition(o,Jn):Jn.fromBufferAttribute(r,o),Jn.applyMatrix4(t.matrixWorld),this.expandByPoint(Jn);else t.boundingBox!==void 0?(t.boundingBox===null&&t.computeBoundingBox(),Ya.copy(t.boundingBox)):(n.boundingBox===null&&n.computeBoundingBox(),Ya.copy(n.boundingBox)),Ya.applyMatrix4(t.matrixWorld),this.union(Ya)}const s=t.children;for(let r=0,o=s.length;r<o;r++)this.expandByObject(s[r],e);return this}containsPoint(t){return t.x>=this.min.x&&t.x<=this.max.x&&t.y>=this.min.y&&t.y<=this.max.y&&t.z>=this.min.z&&t.z<=this.max.z}containsBox(t){return this.min.x<=t.min.x&&t.max.x<=this.max.x&&this.min.y<=t.min.y&&t.max.y<=this.max.y&&this.min.z<=t.min.z&&t.max.z<=this.max.z}getParameter(t,e){return e.set((t.x-this.min.x)/(this.max.x-this.min.x),(t.y-this.min.y)/(this.max.y-this.min.y),(t.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(t){return t.max.x>=this.min.x&&t.min.x<=this.max.x&&t.max.y>=this.min.y&&t.min.y<=this.max.y&&t.max.z>=this.min.z&&t.min.z<=this.max.z}intersectsSphere(t){return this.clampPoint(t.center,Jn),Jn.distanceToSquared(t.center)<=t.radius*t.radius}intersectsPlane(t){let e,n;return t.normal.x>0?(e=t.normal.x*this.min.x,n=t.normal.x*this.max.x):(e=t.normal.x*this.max.x,n=t.normal.x*this.min.x),t.normal.y>0?(e+=t.normal.y*this.min.y,n+=t.normal.y*this.max.y):(e+=t.normal.y*this.max.y,n+=t.normal.y*this.min.y),t.normal.z>0?(e+=t.normal.z*this.min.z,n+=t.normal.z*this.max.z):(e+=t.normal.z*this.max.z,n+=t.normal.z*this.min.z),e<=-t.constant&&n>=-t.constant}intersectsTriangle(t){if(this.isEmpty())return!1;this.getCenter(Po),Ja.subVectors(this.max,Po),fr.subVectors(t.a,Po),pr.subVectors(t.b,Po),mr.subVectors(t.c,Po),Ki.subVectors(pr,fr),$i.subVectors(mr,pr),Rs.subVectors(fr,mr);let e=[0,-Ki.z,Ki.y,0,-$i.z,$i.y,0,-Rs.z,Rs.y,Ki.z,0,-Ki.x,$i.z,0,-$i.x,Rs.z,0,-Rs.x,-Ki.y,Ki.x,0,-$i.y,$i.x,0,-Rs.y,Rs.x,0];return!eu(e,fr,pr,mr,Ja)||(e=[1,0,0,0,1,0,0,0,1],!eu(e,fr,pr,mr,Ja))?!1:(Za.crossVectors(Ki,$i),e=[Za.x,Za.y,Za.z],eu(e,fr,pr,mr,Ja))}clampPoint(t,e){return e.copy(t).clamp(this.min,this.max)}distanceToPoint(t){return this.clampPoint(t,Jn).distanceTo(t)}getBoundingSphere(t){return this.isEmpty()?t.makeEmpty():(this.getCenter(t.center),t.radius=this.getSize(Jn).length()*.5),t}intersect(t){return this.min.max(t.min),this.max.min(t.max),this.isEmpty()&&this.makeEmpty(),this}union(t){return this.min.min(t.min),this.max.max(t.max),this}applyMatrix4(t){return this.isEmpty()?this:(Ii[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(t),Ii[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(t),Ii[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(t),Ii[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(t),Ii[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(t),Ii[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(t),Ii[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(t),Ii[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(t),this.setFromPoints(Ii),this)}translate(t){return this.min.add(t),this.max.add(t),this}equals(t){return t.min.equals(this.min)&&t.max.equals(this.max)}}const Ii=[new O,new O,new O,new O,new O,new O,new O,new O],Jn=new O,Ya=new Ti,fr=new O,pr=new O,mr=new O,Ki=new O,$i=new O,Rs=new O,Po=new O,Ja=new O,Za=new O,Is=new O;function eu(i,t,e,n,s){for(let r=0,o=i.length-3;r<=o;r+=3){Is.fromArray(i,r);const a=s.x*Math.abs(Is.x)+s.y*Math.abs(Is.y)+s.z*Math.abs(Is.z),c=t.dot(Is),l=e.dot(Is),h=n.dot(Is);if(Math.max(-Math.max(c,l,h),Math.min(c,l,h))>a)return!1}return!0}const Lx=new Ti,Do=new O,nu=new O;class Si{constructor(t=new O,e=-1){this.isSphere=!0,this.center=t,this.radius=e}set(t,e){return this.center.copy(t),this.radius=e,this}setFromPoints(t,e){const n=this.center;e!==void 0?n.copy(e):Lx.setFromPoints(t).getCenter(n);let s=0;for(let r=0,o=t.length;r<o;r++)s=Math.max(s,n.distanceToSquared(t[r]));return this.radius=Math.sqrt(s),this}copy(t){return this.center.copy(t.center),this.radius=t.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(t){return t.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(t){return t.distanceTo(this.center)-this.radius}intersectsSphere(t){const e=this.radius+t.radius;return t.center.distanceToSquared(this.center)<=e*e}intersectsBox(t){return t.intersectsSphere(this)}intersectsPlane(t){return Math.abs(t.distanceToPoint(this.center))<=this.radius}clampPoint(t,e){const n=this.center.distanceToSquared(t);return e.copy(t),n>this.radius*this.radius&&(e.sub(this.center).normalize(),e.multiplyScalar(this.radius).add(this.center)),e}getBoundingBox(t){return this.isEmpty()?(t.makeEmpty(),t):(t.set(this.center,this.center),t.expandByScalar(this.radius),t)}applyMatrix4(t){return this.center.applyMatrix4(t),this.radius=this.radius*t.getMaxScaleOnAxis(),this}translate(t){return this.center.add(t),this}expandByPoint(t){if(this.isEmpty())return this.center.copy(t),this.radius=0,this;Do.subVectors(t,this.center);const e=Do.lengthSq();if(e>this.radius*this.radius){const n=Math.sqrt(e),s=(n-this.radius)*.5;this.center.addScaledVector(Do,s/n),this.radius+=s}return this}union(t){return t.isEmpty()?this:this.isEmpty()?(this.copy(t),this):(this.center.equals(t.center)===!0?this.radius=Math.max(this.radius,t.radius):(nu.subVectors(t.center,this.center).setLength(t.radius),this.expandByPoint(Do.copy(t.center).add(nu)),this.expandByPoint(Do.copy(t.center).sub(nu))),this)}equals(t){return t.center.equals(this.center)&&t.radius===this.radius}clone(){return new this.constructor().copy(this)}}const Ci=new O,iu=new O,Qa=new O,Yi=new O,su=new O,tc=new O,ru=new O;class Ca{constructor(t=new O,e=new O(0,0,-1)){this.origin=t,this.direction=e}set(t,e){return this.origin.copy(t),this.direction.copy(e),this}copy(t){return this.origin.copy(t.origin),this.direction.copy(t.direction),this}at(t,e){return e.copy(this.origin).addScaledVector(this.direction,t)}lookAt(t){return this.direction.copy(t).sub(this.origin).normalize(),this}recast(t){return this.origin.copy(this.at(t,Ci)),this}closestPointToPoint(t,e){e.subVectors(t,this.origin);const n=e.dot(this.direction);return n<0?e.copy(this.origin):e.copy(this.origin).addScaledVector(this.direction,n)}distanceToPoint(t){return Math.sqrt(this.distanceSqToPoint(t))}distanceSqToPoint(t){const e=Ci.subVectors(t,this.origin).dot(this.direction);return e<0?this.origin.distanceToSquared(t):(Ci.copy(this.origin).addScaledVector(this.direction,e),Ci.distanceToSquared(t))}distanceSqToSegment(t,e,n,s){iu.copy(t).add(e).multiplyScalar(.5),Qa.copy(e).sub(t).normalize(),Yi.copy(this.origin).sub(iu);const r=t.distanceTo(e)*.5,o=-this.direction.dot(Qa),a=Yi.dot(this.direction),c=-Yi.dot(Qa),l=Yi.lengthSq(),h=Math.abs(1-o*o);let d,f,p,v;if(h>0)if(d=o*c-a,f=o*a-c,v=r*h,d>=0)if(f>=-v)if(f<=v){const x=1/h;d*=x,f*=x,p=d*(d+o*f+2*a)+f*(o*d+f+2*c)+l}else f=r,d=Math.max(0,-(o*f+a)),p=-d*d+f*(f+2*c)+l;else f=-r,d=Math.max(0,-(o*f+a)),p=-d*d+f*(f+2*c)+l;else f<=-v?(d=Math.max(0,-(-o*r+a)),f=d>0?-r:Math.min(Math.max(-r,-c),r),p=-d*d+f*(f+2*c)+l):f<=v?(d=0,f=Math.min(Math.max(-r,-c),r),p=f*(f+2*c)+l):(d=Math.max(0,-(o*r+a)),f=d>0?r:Math.min(Math.max(-r,-c),r),p=-d*d+f*(f+2*c)+l);else f=o>0?-r:r,d=Math.max(0,-(o*f+a)),p=-d*d+f*(f+2*c)+l;return n&&n.copy(this.origin).addScaledVector(this.direction,d),s&&s.copy(iu).addScaledVector(Qa,f),p}intersectSphere(t,e){Ci.subVectors(t.center,this.origin);const n=Ci.dot(this.direction),s=Ci.dot(Ci)-n*n,r=t.radius*t.radius;if(s>r)return null;const o=Math.sqrt(r-s),a=n-o,c=n+o;return c<0?null:a<0?this.at(c,e):this.at(a,e)}intersectsSphere(t){return this.distanceSqToPoint(t.center)<=t.radius*t.radius}distanceToPlane(t){const e=t.normal.dot(this.direction);if(e===0)return t.distanceToPoint(this.origin)===0?0:null;const n=-(this.origin.dot(t.normal)+t.constant)/e;return n>=0?n:null}intersectPlane(t,e){const n=this.distanceToPlane(t);return n===null?null:this.at(n,e)}intersectsPlane(t){const e=t.distanceToPoint(this.origin);return e===0||t.normal.dot(this.direction)*e<0}intersectBox(t,e){let n,s,r,o,a,c;const l=1/this.direction.x,h=1/this.direction.y,d=1/this.direction.z,f=this.origin;return l>=0?(n=(t.min.x-f.x)*l,s=(t.max.x-f.x)*l):(n=(t.max.x-f.x)*l,s=(t.min.x-f.x)*l),h>=0?(r=(t.min.y-f.y)*h,o=(t.max.y-f.y)*h):(r=(t.max.y-f.y)*h,o=(t.min.y-f.y)*h),n>o||r>s||((r>n||isNaN(n))&&(n=r),(o<s||isNaN(s))&&(s=o),d>=0?(a=(t.min.z-f.z)*d,c=(t.max.z-f.z)*d):(a=(t.max.z-f.z)*d,c=(t.min.z-f.z)*d),n>c||a>s)||((a>n||n!==n)&&(n=a),(c<s||s!==s)&&(s=c),s<0)?null:this.at(n>=0?n:s,e)}intersectsBox(t){return this.intersectBox(t,Ci)!==null}intersectTriangle(t,e,n,s,r){su.subVectors(e,t),tc.subVectors(n,t),ru.crossVectors(su,tc);let o=this.direction.dot(ru),a;if(o>0){if(s)return null;a=1}else if(o<0)a=-1,o=-o;else return null;Yi.subVectors(this.origin,t);const c=a*this.direction.dot(tc.crossVectors(Yi,tc));if(c<0)return null;const l=a*this.direction.dot(su.cross(Yi));if(l<0||c+l>o)return null;const h=-a*Yi.dot(ru);return h<0?null:this.at(h/o,r)}applyMatrix4(t){return this.origin.applyMatrix4(t),this.direction.transformDirection(t),this}equals(t){return t.origin.equals(this.origin)&&t.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}}class Gt{constructor(t,e,n,s,r,o,a,c,l,h,d,f,p,v,x,m){Gt.prototype.isMatrix4=!0,this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],t!==void 0&&this.set(t,e,n,s,r,o,a,c,l,h,d,f,p,v,x,m)}set(t,e,n,s,r,o,a,c,l,h,d,f,p,v,x,m){const _=this.elements;return _[0]=t,_[4]=e,_[8]=n,_[12]=s,_[1]=r,_[5]=o,_[9]=a,_[13]=c,_[2]=l,_[6]=h,_[10]=d,_[14]=f,_[3]=p,_[7]=v,_[11]=x,_[15]=m,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new Gt().fromArray(this.elements)}copy(t){const e=this.elements,n=t.elements;return e[0]=n[0],e[1]=n[1],e[2]=n[2],e[3]=n[3],e[4]=n[4],e[5]=n[5],e[6]=n[6],e[7]=n[7],e[8]=n[8],e[9]=n[9],e[10]=n[10],e[11]=n[11],e[12]=n[12],e[13]=n[13],e[14]=n[14],e[15]=n[15],this}copyPosition(t){const e=this.elements,n=t.elements;return e[12]=n[12],e[13]=n[13],e[14]=n[14],this}setFromMatrix3(t){const e=t.elements;return this.set(e[0],e[3],e[6],0,e[1],e[4],e[7],0,e[2],e[5],e[8],0,0,0,0,1),this}extractBasis(t,e,n){return t.setFromMatrixColumn(this,0),e.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this}makeBasis(t,e,n){return this.set(t.x,e.x,n.x,0,t.y,e.y,n.y,0,t.z,e.z,n.z,0,0,0,0,1),this}extractRotation(t){const e=this.elements,n=t.elements,s=1/gr.setFromMatrixColumn(t,0).length(),r=1/gr.setFromMatrixColumn(t,1).length(),o=1/gr.setFromMatrixColumn(t,2).length();return e[0]=n[0]*s,e[1]=n[1]*s,e[2]=n[2]*s,e[3]=0,e[4]=n[4]*r,e[5]=n[5]*r,e[6]=n[6]*r,e[7]=0,e[8]=n[8]*o,e[9]=n[9]*o,e[10]=n[10]*o,e[11]=0,e[12]=0,e[13]=0,e[14]=0,e[15]=1,this}makeRotationFromEuler(t){const e=this.elements,n=t.x,s=t.y,r=t.z,o=Math.cos(n),a=Math.sin(n),c=Math.cos(s),l=Math.sin(s),h=Math.cos(r),d=Math.sin(r);if(t.order==="XYZ"){const f=o*h,p=o*d,v=a*h,x=a*d;e[0]=c*h,e[4]=-c*d,e[8]=l,e[1]=p+v*l,e[5]=f-x*l,e[9]=-a*c,e[2]=x-f*l,e[6]=v+p*l,e[10]=o*c}else if(t.order==="YXZ"){const f=c*h,p=c*d,v=l*h,x=l*d;e[0]=f+x*a,e[4]=v*a-p,e[8]=o*l,e[1]=o*d,e[5]=o*h,e[9]=-a,e[2]=p*a-v,e[6]=x+f*a,e[10]=o*c}else if(t.order==="ZXY"){const f=c*h,p=c*d,v=l*h,x=l*d;e[0]=f-x*a,e[4]=-o*d,e[8]=v+p*a,e[1]=p+v*a,e[5]=o*h,e[9]=x-f*a,e[2]=-o*l,e[6]=a,e[10]=o*c}else if(t.order==="ZYX"){const f=o*h,p=o*d,v=a*h,x=a*d;e[0]=c*h,e[4]=v*l-p,e[8]=f*l+x,e[1]=c*d,e[5]=x*l+f,e[9]=p*l-v,e[2]=-l,e[6]=a*c,e[10]=o*c}else if(t.order==="YZX"){const f=o*c,p=o*l,v=a*c,x=a*l;e[0]=c*h,e[4]=x-f*d,e[8]=v*d+p,e[1]=d,e[5]=o*h,e[9]=-a*h,e[2]=-l*h,e[6]=p*d+v,e[10]=f-x*d}else if(t.order==="XZY"){const f=o*c,p=o*l,v=a*c,x=a*l;e[0]=c*h,e[4]=-d,e[8]=l*h,e[1]=f*d+x,e[5]=o*h,e[9]=p*d-v,e[2]=v*d-p,e[6]=a*h,e[10]=x*d+f}return e[3]=0,e[7]=0,e[11]=0,e[12]=0,e[13]=0,e[14]=0,e[15]=1,this}makeRotationFromQuaternion(t){return this.compose(Nx,t,Ux)}lookAt(t,e,n){const s=this.elements;return Un.subVectors(t,e),Un.lengthSq()===0&&(Un.z=1),Un.normalize(),Ji.crossVectors(n,Un),Ji.lengthSq()===0&&(Math.abs(n.z)===1?Un.x+=1e-4:Un.z+=1e-4,Un.normalize(),Ji.crossVectors(n,Un)),Ji.normalize(),ec.crossVectors(Un,Ji),s[0]=Ji.x,s[4]=ec.x,s[8]=Un.x,s[1]=Ji.y,s[5]=ec.y,s[9]=Un.y,s[2]=Ji.z,s[6]=ec.z,s[10]=Un.z,this}multiply(t){return this.multiplyMatrices(this,t)}premultiply(t){return this.multiplyMatrices(t,this)}multiplyMatrices(t,e){const n=t.elements,s=e.elements,r=this.elements,o=n[0],a=n[4],c=n[8],l=n[12],h=n[1],d=n[5],f=n[9],p=n[13],v=n[2],x=n[6],m=n[10],_=n[14],A=n[3],S=n[7],b=n[11],F=n[15],N=s[0],M=s[4],w=s[8],C=s[12],y=s[1],E=s[5],L=s[9],R=s[13],q=s[2],nt=s[6],j=s[10],ot=s[14],Y=s[3],Et=s[7],Tt=s[11],Ct=s[15];return r[0]=o*N+a*y+c*q+l*Y,r[4]=o*M+a*E+c*nt+l*Et,r[8]=o*w+a*L+c*j+l*Tt,r[12]=o*C+a*R+c*ot+l*Ct,r[1]=h*N+d*y+f*q+p*Y,r[5]=h*M+d*E+f*nt+p*Et,r[9]=h*w+d*L+f*j+p*Tt,r[13]=h*C+d*R+f*ot+p*Ct,r[2]=v*N+x*y+m*q+_*Y,r[6]=v*M+x*E+m*nt+_*Et,r[10]=v*w+x*L+m*j+_*Tt,r[14]=v*C+x*R+m*ot+_*Ct,r[3]=A*N+S*y+b*q+F*Y,r[7]=A*M+S*E+b*nt+F*Et,r[11]=A*w+S*L+b*j+F*Tt,r[15]=A*C+S*R+b*ot+F*Ct,this}multiplyScalar(t){const e=this.elements;return e[0]*=t,e[4]*=t,e[8]*=t,e[12]*=t,e[1]*=t,e[5]*=t,e[9]*=t,e[13]*=t,e[2]*=t,e[6]*=t,e[10]*=t,e[14]*=t,e[3]*=t,e[7]*=t,e[11]*=t,e[15]*=t,this}determinant(){const t=this.elements,e=t[0],n=t[4],s=t[8],r=t[12],o=t[1],a=t[5],c=t[9],l=t[13],h=t[2],d=t[6],f=t[10],p=t[14],v=t[3],x=t[7],m=t[11],_=t[15];return v*(+r*c*d-s*l*d-r*a*f+n*l*f+s*a*p-n*c*p)+x*(+e*c*p-e*l*f+r*o*f-s*o*p+s*l*h-r*c*h)+m*(+e*l*d-e*a*p-r*o*d+n*o*p+r*a*h-n*l*h)+_*(-s*a*h-e*c*d+e*a*f+s*o*d-n*o*f+n*c*h)}transpose(){const t=this.elements;let e;return e=t[1],t[1]=t[4],t[4]=e,e=t[2],t[2]=t[8],t[8]=e,e=t[6],t[6]=t[9],t[9]=e,e=t[3],t[3]=t[12],t[12]=e,e=t[7],t[7]=t[13],t[13]=e,e=t[11],t[11]=t[14],t[14]=e,this}setPosition(t,e,n){const s=this.elements;return t.isVector3?(s[12]=t.x,s[13]=t.y,s[14]=t.z):(s[12]=t,s[13]=e,s[14]=n),this}invert(){const t=this.elements,e=t[0],n=t[1],s=t[2],r=t[3],o=t[4],a=t[5],c=t[6],l=t[7],h=t[8],d=t[9],f=t[10],p=t[11],v=t[12],x=t[13],m=t[14],_=t[15],A=d*m*l-x*f*l+x*c*p-a*m*p-d*c*_+a*f*_,S=v*f*l-h*m*l-v*c*p+o*m*p+h*c*_-o*f*_,b=h*x*l-v*d*l+v*a*p-o*x*p-h*a*_+o*d*_,F=v*d*c-h*x*c-v*a*f+o*x*f+h*a*m-o*d*m,N=e*A+n*S+s*b+r*F;if(N===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);const M=1/N;return t[0]=A*M,t[1]=(x*f*r-d*m*r-x*s*p+n*m*p+d*s*_-n*f*_)*M,t[2]=(a*m*r-x*c*r+x*s*l-n*m*l-a*s*_+n*c*_)*M,t[3]=(d*c*r-a*f*r-d*s*l+n*f*l+a*s*p-n*c*p)*M,t[4]=S*M,t[5]=(h*m*r-v*f*r+v*s*p-e*m*p-h*s*_+e*f*_)*M,t[6]=(v*c*r-o*m*r-v*s*l+e*m*l+o*s*_-e*c*_)*M,t[7]=(o*f*r-h*c*r+h*s*l-e*f*l-o*s*p+e*c*p)*M,t[8]=b*M,t[9]=(v*d*r-h*x*r-v*n*p+e*x*p+h*n*_-e*d*_)*M,t[10]=(o*x*r-v*a*r+v*n*l-e*x*l-o*n*_+e*a*_)*M,t[11]=(h*a*r-o*d*r-h*n*l+e*d*l+o*n*p-e*a*p)*M,t[12]=F*M,t[13]=(h*x*s-v*d*s+v*n*f-e*x*f-h*n*m+e*d*m)*M,t[14]=(v*a*s-o*x*s-v*n*c+e*x*c+o*n*m-e*a*m)*M,t[15]=(o*d*s-h*a*s+h*n*c-e*d*c-o*n*f+e*a*f)*M,this}scale(t){const e=this.elements,n=t.x,s=t.y,r=t.z;return e[0]*=n,e[4]*=s,e[8]*=r,e[1]*=n,e[5]*=s,e[9]*=r,e[2]*=n,e[6]*=s,e[10]*=r,e[3]*=n,e[7]*=s,e[11]*=r,this}getMaxScaleOnAxis(){const t=this.elements,e=t[0]*t[0]+t[1]*t[1]+t[2]*t[2],n=t[4]*t[4]+t[5]*t[5]+t[6]*t[6],s=t[8]*t[8]+t[9]*t[9]+t[10]*t[10];return Math.sqrt(Math.max(e,n,s))}makeTranslation(t,e,n){return t.isVector3?this.set(1,0,0,t.x,0,1,0,t.y,0,0,1,t.z,0,0,0,1):this.set(1,0,0,t,0,1,0,e,0,0,1,n,0,0,0,1),this}makeRotationX(t){const e=Math.cos(t),n=Math.sin(t);return this.set(1,0,0,0,0,e,-n,0,0,n,e,0,0,0,0,1),this}makeRotationY(t){const e=Math.cos(t),n=Math.sin(t);return this.set(e,0,n,0,0,1,0,0,-n,0,e,0,0,0,0,1),this}makeRotationZ(t){const e=Math.cos(t),n=Math.sin(t);return this.set(e,-n,0,0,n,e,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(t,e){const n=Math.cos(e),s=Math.sin(e),r=1-n,o=t.x,a=t.y,c=t.z,l=r*o,h=r*a;return this.set(l*o+n,l*a-s*c,l*c+s*a,0,l*a+s*c,h*a+n,h*c-s*o,0,l*c-s*a,h*c+s*o,r*c*c+n,0,0,0,0,1),this}makeScale(t,e,n){return this.set(t,0,0,0,0,e,0,0,0,0,n,0,0,0,0,1),this}makeShear(t,e,n,s,r,o){return this.set(1,n,r,0,t,1,o,0,e,s,1,0,0,0,0,1),this}compose(t,e,n){const s=this.elements,r=e._x,o=e._y,a=e._z,c=e._w,l=r+r,h=o+o,d=a+a,f=r*l,p=r*h,v=r*d,x=o*h,m=o*d,_=a*d,A=c*l,S=c*h,b=c*d,F=n.x,N=n.y,M=n.z;return s[0]=(1-(x+_))*F,s[1]=(p+b)*F,s[2]=(v-S)*F,s[3]=0,s[4]=(p-b)*N,s[5]=(1-(f+_))*N,s[6]=(m+A)*N,s[7]=0,s[8]=(v+S)*M,s[9]=(m-A)*M,s[10]=(1-(f+x))*M,s[11]=0,s[12]=t.x,s[13]=t.y,s[14]=t.z,s[15]=1,this}decompose(t,e,n){const s=this.elements;let r=gr.set(s[0],s[1],s[2]).length();const o=gr.set(s[4],s[5],s[6]).length(),a=gr.set(s[8],s[9],s[10]).length();this.determinant()<0&&(r=-r),t.x=s[12],t.y=s[13],t.z=s[14],Zn.copy(this);const l=1/r,h=1/o,d=1/a;return Zn.elements[0]*=l,Zn.elements[1]*=l,Zn.elements[2]*=l,Zn.elements[4]*=h,Zn.elements[5]*=h,Zn.elements[6]*=h,Zn.elements[8]*=d,Zn.elements[9]*=d,Zn.elements[10]*=d,e.setFromRotationMatrix(Zn),n.x=r,n.y=o,n.z=a,this}makePerspective(t,e,n,s,r,o,a=Vi){const c=this.elements,l=2*r/(e-t),h=2*r/(n-s),d=(e+t)/(e-t),f=(n+s)/(n-s);let p,v;if(a===Vi)p=-(o+r)/(o-r),v=-2*o*r/(o-r);else if(a===el)p=-o/(o-r),v=-o*r/(o-r);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+a);return c[0]=l,c[4]=0,c[8]=d,c[12]=0,c[1]=0,c[5]=h,c[9]=f,c[13]=0,c[2]=0,c[6]=0,c[10]=p,c[14]=v,c[3]=0,c[7]=0,c[11]=-1,c[15]=0,this}makeOrthographic(t,e,n,s,r,o,a=Vi){const c=this.elements,l=1/(e-t),h=1/(n-s),d=1/(o-r),f=(e+t)*l,p=(n+s)*h;let v,x;if(a===Vi)v=(o+r)*d,x=-2*d;else if(a===el)v=r*d,x=-1*d;else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+a);return c[0]=2*l,c[4]=0,c[8]=0,c[12]=-f,c[1]=0,c[5]=2*h,c[9]=0,c[13]=-p,c[2]=0,c[6]=0,c[10]=x,c[14]=-v,c[3]=0,c[7]=0,c[11]=0,c[15]=1,this}equals(t){const e=this.elements,n=t.elements;for(let s=0;s<16;s++)if(e[s]!==n[s])return!1;return!0}fromArray(t,e=0){for(let n=0;n<16;n++)this.elements[n]=t[n+e];return this}toArray(t=[],e=0){const n=this.elements;return t[e]=n[0],t[e+1]=n[1],t[e+2]=n[2],t[e+3]=n[3],t[e+4]=n[4],t[e+5]=n[5],t[e+6]=n[6],t[e+7]=n[7],t[e+8]=n[8],t[e+9]=n[9],t[e+10]=n[10],t[e+11]=n[11],t[e+12]=n[12],t[e+13]=n[13],t[e+14]=n[14],t[e+15]=n[15],t}}const gr=new O,Zn=new Gt,Nx=new O(0,0,0),Ux=new O(1,1,1),Ji=new O,ec=new O,Un=new O,up=new Gt,hp=new oi;class ai{constructor(t=0,e=0,n=0,s=ai.DEFAULT_ORDER){this.isEuler=!0,this._x=t,this._y=e,this._z=n,this._order=s}get x(){return this._x}set x(t){this._x=t,this._onChangeCallback()}get y(){return this._y}set y(t){this._y=t,this._onChangeCallback()}get z(){return this._z}set z(t){this._z=t,this._onChangeCallback()}get order(){return this._order}set order(t){this._order=t,this._onChangeCallback()}set(t,e,n,s=this._order){return this._x=t,this._y=e,this._z=n,this._order=s,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(t){return this._x=t._x,this._y=t._y,this._z=t._z,this._order=t._order,this._onChangeCallback(),this}setFromRotationMatrix(t,e=this._order,n=!0){const s=t.elements,r=s[0],o=s[4],a=s[8],c=s[1],l=s[5],h=s[9],d=s[2],f=s[6],p=s[10];switch(e){case"XYZ":this._y=Math.asin($e(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(-h,p),this._z=Math.atan2(-o,r)):(this._x=Math.atan2(f,l),this._z=0);break;case"YXZ":this._x=Math.asin(-$e(h,-1,1)),Math.abs(h)<.9999999?(this._y=Math.atan2(a,p),this._z=Math.atan2(c,l)):(this._y=Math.atan2(-d,r),this._z=0);break;case"ZXY":this._x=Math.asin($e(f,-1,1)),Math.abs(f)<.9999999?(this._y=Math.atan2(-d,p),this._z=Math.atan2(-o,l)):(this._y=0,this._z=Math.atan2(c,r));break;case"ZYX":this._y=Math.asin(-$e(d,-1,1)),Math.abs(d)<.9999999?(this._x=Math.atan2(f,p),this._z=Math.atan2(c,r)):(this._x=0,this._z=Math.atan2(-o,l));break;case"YZX":this._z=Math.asin($e(c,-1,1)),Math.abs(c)<.9999999?(this._x=Math.atan2(-h,l),this._y=Math.atan2(-d,r)):(this._x=0,this._y=Math.atan2(a,p));break;case"XZY":this._z=Math.asin(-$e(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(f,l),this._y=Math.atan2(a,r)):(this._x=Math.atan2(-h,p),this._y=0);break;default:console.warn("THREE.Euler: .setFromRotationMatrix() encountered an unknown order: "+e)}return this._order=e,n===!0&&this._onChangeCallback(),this}setFromQuaternion(t,e,n){return up.makeRotationFromQuaternion(t),this.setFromRotationMatrix(up,e,n)}setFromVector3(t,e=this._order){return this.set(t.x,t.y,t.z,e)}reorder(t){return hp.setFromEuler(this),this.setFromQuaternion(hp,t)}equals(t){return t._x===this._x&&t._y===this._y&&t._z===this._z&&t._order===this._order}fromArray(t){return this._x=t[0],this._y=t[1],this._z=t[2],t[3]!==void 0&&(this._order=t[3]),this._onChangeCallback(),this}toArray(t=[],e=0){return t[e]=this._x,t[e+1]=this._y,t[e+2]=this._z,t[e+3]=this._order,t}_onChange(t){return this._onChangeCallback=t,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}}ai.DEFAULT_ORDER="XYZ";class bd{constructor(){this.mask=1}set(t){this.mask=(1<<t|0)>>>0}enable(t){this.mask|=1<<t|0}enableAll(){this.mask=-1}toggle(t){this.mask^=1<<t|0}disable(t){this.mask&=~(1<<t|0)}disableAll(){this.mask=0}test(t){return(this.mask&t.mask)!==0}isEnabled(t){return(this.mask&(1<<t|0))!==0}}let Ox=0;const dp=new O,_r=new oi,Pi=new Gt,nc=new O,Lo=new O,Fx=new O,Vx=new oi,fp=new O(1,0,0),pp=new O(0,1,0),mp=new O(0,0,1),gp={type:"added"},Bx={type:"removed"},vr={type:"childadded",child:null},ou={type:"childremoved",child:null};class Me extends Ms{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:Ox++}),this.uuid=qn(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=Me.DEFAULT_UP.clone();const t=new O,e=new ai,n=new oi,s=new O(1,1,1);function r(){n.setFromEuler(e,!1)}function o(){e.setFromQuaternion(n,void 0,!1)}e._onChange(r),n._onChange(o),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:t},rotation:{configurable:!0,enumerable:!0,value:e},quaternion:{configurable:!0,enumerable:!0,value:n},scale:{configurable:!0,enumerable:!0,value:s},modelViewMatrix:{value:new Gt},normalMatrix:{value:new Jt}}),this.matrix=new Gt,this.matrixWorld=new Gt,this.matrixAutoUpdate=Me.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=Me.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new bd,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.userData={}}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(t){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(t),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(t){return this.quaternion.premultiply(t),this}setRotationFromAxisAngle(t,e){this.quaternion.setFromAxisAngle(t,e)}setRotationFromEuler(t){this.quaternion.setFromEuler(t,!0)}setRotationFromMatrix(t){this.quaternion.setFromRotationMatrix(t)}setRotationFromQuaternion(t){this.quaternion.copy(t)}rotateOnAxis(t,e){return _r.setFromAxisAngle(t,e),this.quaternion.multiply(_r),this}rotateOnWorldAxis(t,e){return _r.setFromAxisAngle(t,e),this.quaternion.premultiply(_r),this}rotateX(t){return this.rotateOnAxis(fp,t)}rotateY(t){return this.rotateOnAxis(pp,t)}rotateZ(t){return this.rotateOnAxis(mp,t)}translateOnAxis(t,e){return dp.copy(t).applyQuaternion(this.quaternion),this.position.add(dp.multiplyScalar(e)),this}translateX(t){return this.translateOnAxis(fp,t)}translateY(t){return this.translateOnAxis(pp,t)}translateZ(t){return this.translateOnAxis(mp,t)}localToWorld(t){return this.updateWorldMatrix(!0,!1),t.applyMatrix4(this.matrixWorld)}worldToLocal(t){return this.updateWorldMatrix(!0,!1),t.applyMatrix4(Pi.copy(this.matrixWorld).invert())}lookAt(t,e,n){t.isVector3?nc.copy(t):nc.set(t,e,n);const s=this.parent;this.updateWorldMatrix(!0,!1),Lo.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?Pi.lookAt(Lo,nc,this.up):Pi.lookAt(nc,Lo,this.up),this.quaternion.setFromRotationMatrix(Pi),s&&(Pi.extractRotation(s.matrixWorld),_r.setFromRotationMatrix(Pi),this.quaternion.premultiply(_r.invert()))}add(t){if(arguments.length>1){for(let e=0;e<arguments.length;e++)this.add(arguments[e]);return this}return t===this?(console.error("THREE.Object3D.add: object can't be added as a child of itself.",t),this):(t&&t.isObject3D?(t.removeFromParent(),t.parent=this,this.children.push(t),t.dispatchEvent(gp),vr.child=t,this.dispatchEvent(vr),vr.child=null):console.error("THREE.Object3D.add: object not an instance of THREE.Object3D.",t),this)}remove(t){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.remove(arguments[n]);return this}const e=this.children.indexOf(t);return e!==-1&&(t.parent=null,this.children.splice(e,1),t.dispatchEvent(Bx),ou.child=t,this.dispatchEvent(ou),ou.child=null),this}removeFromParent(){const t=this.parent;return t!==null&&t.remove(this),this}clear(){return this.remove(...this.children)}attach(t){return this.updateWorldMatrix(!0,!1),Pi.copy(this.matrixWorld).invert(),t.parent!==null&&(t.parent.updateWorldMatrix(!0,!1),Pi.multiply(t.parent.matrixWorld)),t.applyMatrix4(Pi),t.removeFromParent(),t.parent=this,this.children.push(t),t.updateWorldMatrix(!1,!0),t.dispatchEvent(gp),vr.child=t,this.dispatchEvent(vr),vr.child=null,this}getObjectById(t){return this.getObjectByProperty("id",t)}getObjectByName(t){return this.getObjectByProperty("name",t)}getObjectByProperty(t,e){if(this[t]===e)return this;for(let n=0,s=this.children.length;n<s;n++){const o=this.children[n].getObjectByProperty(t,e);if(o!==void 0)return o}}getObjectsByProperty(t,e,n=[]){this[t]===e&&n.push(this);const s=this.children;for(let r=0,o=s.length;r<o;r++)s[r].getObjectsByProperty(t,e,n);return n}getWorldPosition(t){return this.updateWorldMatrix(!0,!1),t.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(t){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Lo,t,Fx),t}getWorldScale(t){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Lo,Vx,t),t}getWorldDirection(t){this.updateWorldMatrix(!0,!1);const e=this.matrixWorld.elements;return t.set(e[8],e[9],e[10]).normalize()}raycast(){}traverse(t){t(this);const e=this.children;for(let n=0,s=e.length;n<s;n++)e[n].traverse(t)}traverseVisible(t){if(this.visible===!1)return;t(this);const e=this.children;for(let n=0,s=e.length;n<s;n++)e[n].traverseVisible(t)}traverseAncestors(t){const e=this.parent;e!==null&&(t(e),e.traverseAncestors(t))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale),this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(t){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||t)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,t=!0);const e=this.children;for(let n=0,s=e.length;n<s;n++)e[n].updateMatrixWorld(t)}updateWorldMatrix(t,e){const n=this.parent;if(t===!0&&n!==null&&n.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),e===!0){const s=this.children;for(let r=0,o=s.length;r<o;r++)s[r].updateWorldMatrix(!1,!0)}}toJSON(t){const e=t===void 0||typeof t=="string",n={};e&&(t={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},n.metadata={version:4.6,type:"Object",generator:"Object3D.toJSON"});const s={};s.uuid=this.uuid,s.type=this.type,this.name!==""&&(s.name=this.name),this.castShadow===!0&&(s.castShadow=!0),this.receiveShadow===!0&&(s.receiveShadow=!0),this.visible===!1&&(s.visible=!1),this.frustumCulled===!1&&(s.frustumCulled=!1),this.renderOrder!==0&&(s.renderOrder=this.renderOrder),Object.keys(this.userData).length>0&&(s.userData=this.userData),s.layers=this.layers.mask,s.matrix=this.matrix.toArray(),s.up=this.up.toArray(),this.matrixAutoUpdate===!1&&(s.matrixAutoUpdate=!1),this.isInstancedMesh&&(s.type="InstancedMesh",s.count=this.count,s.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(s.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(s.type="BatchedMesh",s.perObjectFrustumCulled=this.perObjectFrustumCulled,s.sortObjects=this.sortObjects,s.drawRanges=this._drawRanges,s.reservedRanges=this._reservedRanges,s.visibility=this._visibility,s.active=this._active,s.bounds=this._bounds.map(a=>({boxInitialized:a.boxInitialized,boxMin:a.box.min.toArray(),boxMax:a.box.max.toArray(),sphereInitialized:a.sphereInitialized,sphereRadius:a.sphere.radius,sphereCenter:a.sphere.center.toArray()})),s.maxInstanceCount=this._maxInstanceCount,s.maxVertexCount=this._maxVertexCount,s.maxIndexCount=this._maxIndexCount,s.geometryInitialized=this._geometryInitialized,s.geometryCount=this._geometryCount,s.matricesTexture=this._matricesTexture.toJSON(t),this._colorsTexture!==null&&(s.colorsTexture=this._colorsTexture.toJSON(t)),this.boundingSphere!==null&&(s.boundingSphere={center:s.boundingSphere.center.toArray(),radius:s.boundingSphere.radius}),this.boundingBox!==null&&(s.boundingBox={min:s.boundingBox.min.toArray(),max:s.boundingBox.max.toArray()}));function r(a,c){return a[c.uuid]===void 0&&(a[c.uuid]=c.toJSON(t)),c.uuid}if(this.isScene)this.background&&(this.background.isColor?s.background=this.background.toJSON():this.background.isTexture&&(s.background=this.background.toJSON(t).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(s.environment=this.environment.toJSON(t).uuid);else if(this.isMesh||this.isLine||this.isPoints){s.geometry=r(t.geometries,this.geometry);const a=this.geometry.parameters;if(a!==void 0&&a.shapes!==void 0){const c=a.shapes;if(Array.isArray(c))for(let l=0,h=c.length;l<h;l++){const d=c[l];r(t.shapes,d)}else r(t.shapes,c)}}if(this.isSkinnedMesh&&(s.bindMode=this.bindMode,s.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(r(t.skeletons,this.skeleton),s.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){const a=[];for(let c=0,l=this.material.length;c<l;c++)a.push(r(t.materials,this.material[c]));s.material=a}else s.material=r(t.materials,this.material);if(this.children.length>0){s.children=[];for(let a=0;a<this.children.length;a++)s.children.push(this.children[a].toJSON(t).object)}if(this.animations.length>0){s.animations=[];for(let a=0;a<this.animations.length;a++){const c=this.animations[a];s.animations.push(r(t.animations,c))}}if(e){const a=o(t.geometries),c=o(t.materials),l=o(t.textures),h=o(t.images),d=o(t.shapes),f=o(t.skeletons),p=o(t.animations),v=o(t.nodes);a.length>0&&(n.geometries=a),c.length>0&&(n.materials=c),l.length>0&&(n.textures=l),h.length>0&&(n.images=h),d.length>0&&(n.shapes=d),f.length>0&&(n.skeletons=f),p.length>0&&(n.animations=p),v.length>0&&(n.nodes=v)}return n.object=s,n;function o(a){const c=[];for(const l in a){const h=a[l];delete h.metadata,c.push(h)}return c}}clone(t){return new this.constructor().copy(this,t)}copy(t,e=!0){if(this.name=t.name,this.up.copy(t.up),this.position.copy(t.position),this.rotation.order=t.rotation.order,this.quaternion.copy(t.quaternion),this.scale.copy(t.scale),this.matrix.copy(t.matrix),this.matrixWorld.copy(t.matrixWorld),this.matrixAutoUpdate=t.matrixAutoUpdate,this.matrixWorldAutoUpdate=t.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=t.matrixWorldNeedsUpdate,this.layers.mask=t.layers.mask,this.visible=t.visible,this.castShadow=t.castShadow,this.receiveShadow=t.receiveShadow,this.frustumCulled=t.frustumCulled,this.renderOrder=t.renderOrder,this.animations=t.animations.slice(),this.userData=JSON.parse(JSON.stringify(t.userData)),e===!0)for(let n=0;n<t.children.length;n++){const s=t.children[n];this.add(s.clone())}return this}}Me.DEFAULT_UP=new O(0,1,0);Me.DEFAULT_MATRIX_AUTO_UPDATE=!0;Me.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;const Qn=new O,Di=new O,au=new O,Li=new O,yr=new O,xr=new O,_p=new O,cu=new O,lu=new O,uu=new O,hu=new ge,du=new ge,fu=new ge;class Hn{constructor(t=new O,e=new O,n=new O){this.a=t,this.b=e,this.c=n}static getNormal(t,e,n,s){s.subVectors(n,e),Qn.subVectors(t,e),s.cross(Qn);const r=s.lengthSq();return r>0?s.multiplyScalar(1/Math.sqrt(r)):s.set(0,0,0)}static getBarycoord(t,e,n,s,r){Qn.subVectors(s,e),Di.subVectors(n,e),au.subVectors(t,e);const o=Qn.dot(Qn),a=Qn.dot(Di),c=Qn.dot(au),l=Di.dot(Di),h=Di.dot(au),d=o*l-a*a;if(d===0)return r.set(0,0,0),null;const f=1/d,p=(l*c-a*h)*f,v=(o*h-a*c)*f;return r.set(1-p-v,v,p)}static containsPoint(t,e,n,s){return this.getBarycoord(t,e,n,s,Li)===null?!1:Li.x>=0&&Li.y>=0&&Li.x+Li.y<=1}static getInterpolation(t,e,n,s,r,o,a,c){return this.getBarycoord(t,e,n,s,Li)===null?(c.x=0,c.y=0,"z"in c&&(c.z=0),"w"in c&&(c.w=0),null):(c.setScalar(0),c.addScaledVector(r,Li.x),c.addScaledVector(o,Li.y),c.addScaledVector(a,Li.z),c)}static getInterpolatedAttribute(t,e,n,s,r,o){return hu.setScalar(0),du.setScalar(0),fu.setScalar(0),hu.fromBufferAttribute(t,e),du.fromBufferAttribute(t,n),fu.fromBufferAttribute(t,s),o.setScalar(0),o.addScaledVector(hu,r.x),o.addScaledVector(du,r.y),o.addScaledVector(fu,r.z),o}static isFrontFacing(t,e,n,s){return Qn.subVectors(n,e),Di.subVectors(t,e),Qn.cross(Di).dot(s)<0}set(t,e,n){return this.a.copy(t),this.b.copy(e),this.c.copy(n),this}setFromPointsAndIndices(t,e,n,s){return this.a.copy(t[e]),this.b.copy(t[n]),this.c.copy(t[s]),this}setFromAttributeAndIndices(t,e,n,s){return this.a.fromBufferAttribute(t,e),this.b.fromBufferAttribute(t,n),this.c.fromBufferAttribute(t,s),this}clone(){return new this.constructor().copy(this)}copy(t){return this.a.copy(t.a),this.b.copy(t.b),this.c.copy(t.c),this}getArea(){return Qn.subVectors(this.c,this.b),Di.subVectors(this.a,this.b),Qn.cross(Di).length()*.5}getMidpoint(t){return t.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(t){return Hn.getNormal(this.a,this.b,this.c,t)}getPlane(t){return t.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(t,e){return Hn.getBarycoord(t,this.a,this.b,this.c,e)}getInterpolation(t,e,n,s,r){return Hn.getInterpolation(t,this.a,this.b,this.c,e,n,s,r)}containsPoint(t){return Hn.containsPoint(t,this.a,this.b,this.c)}isFrontFacing(t){return Hn.isFrontFacing(this.a,this.b,this.c,t)}intersectsBox(t){return t.intersectsTriangle(this)}closestPointToPoint(t,e){const n=this.a,s=this.b,r=this.c;let o,a;yr.subVectors(s,n),xr.subVectors(r,n),cu.subVectors(t,n);const c=yr.dot(cu),l=xr.dot(cu);if(c<=0&&l<=0)return e.copy(n);lu.subVectors(t,s);const h=yr.dot(lu),d=xr.dot(lu);if(h>=0&&d<=h)return e.copy(s);const f=c*d-h*l;if(f<=0&&c>=0&&h<=0)return o=c/(c-h),e.copy(n).addScaledVector(yr,o);uu.subVectors(t,r);const p=yr.dot(uu),v=xr.dot(uu);if(v>=0&&p<=v)return e.copy(r);const x=p*l-c*v;if(x<=0&&l>=0&&v<=0)return a=l/(l-v),e.copy(n).addScaledVector(xr,a);const m=h*v-p*d;if(m<=0&&d-h>=0&&p-v>=0)return _p.subVectors(r,s),a=(d-h)/(d-h+(p-v)),e.copy(s).addScaledVector(_p,a);const _=1/(m+x+f);return o=x*_,a=f*_,e.copy(n).addScaledVector(yr,o).addScaledVector(xr,a)}equals(t){return t.a.equals(this.a)&&t.b.equals(this.b)&&t.c.equals(this.c)}}const d_={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},Zi={h:0,s:0,l:0},ic={h:0,s:0,l:0};function pu(i,t,e){return e<0&&(e+=1),e>1&&(e-=1),e<1/6?i+(t-i)*6*e:e<1/2?t:e<2/3?i+(t-i)*6*(2/3-e):i}class It{constructor(t,e,n){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(t,e,n)}set(t,e,n){if(e===void 0&&n===void 0){const s=t;s&&s.isColor?this.copy(s):typeof s=="number"?this.setHex(s):typeof s=="string"&&this.setStyle(s)}else this.setRGB(t,e,n);return this}setScalar(t){return this.r=t,this.g=t,this.b=t,this}setHex(t,e=hn){return t=Math.floor(t),this.r=(t>>16&255)/255,this.g=(t>>8&255)/255,this.b=(t&255)/255,me.toWorkingColorSpace(this,e),this}setRGB(t,e,n,s=me.workingColorSpace){return this.r=t,this.g=e,this.b=n,me.toWorkingColorSpace(this,s),this}setHSL(t,e,n,s=me.workingColorSpace){if(t=wd(t,1),e=$e(e,0,1),n=$e(n,0,1),e===0)this.r=this.g=this.b=n;else{const r=n<=.5?n*(1+e):n+e-n*e,o=2*n-r;this.r=pu(o,r,t+1/3),this.g=pu(o,r,t),this.b=pu(o,r,t-1/3)}return me.toWorkingColorSpace(this,s),this}setStyle(t,e=hn){function n(r){r!==void 0&&parseFloat(r)<1&&console.warn("THREE.Color: Alpha component of "+t+" will be ignored.")}let s;if(s=/^(\w+)\(([^\)]*)\)/.exec(t)){let r;const o=s[1],a=s[2];switch(o){case"rgb":case"rgba":if(r=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setRGB(Math.min(255,parseInt(r[1],10))/255,Math.min(255,parseInt(r[2],10))/255,Math.min(255,parseInt(r[3],10))/255,e);if(r=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setRGB(Math.min(100,parseInt(r[1],10))/100,Math.min(100,parseInt(r[2],10))/100,Math.min(100,parseInt(r[3],10))/100,e);break;case"hsl":case"hsla":if(r=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setHSL(parseFloat(r[1])/360,parseFloat(r[2])/100,parseFloat(r[3])/100,e);break;default:console.warn("THREE.Color: Unknown color model "+t)}}else if(s=/^\#([A-Fa-f\d]+)$/.exec(t)){const r=s[1],o=r.length;if(o===3)return this.setRGB(parseInt(r.charAt(0),16)/15,parseInt(r.charAt(1),16)/15,parseInt(r.charAt(2),16)/15,e);if(o===6)return this.setHex(parseInt(r,16),e);console.warn("THREE.Color: Invalid hex color "+t)}else if(t&&t.length>0)return this.setColorName(t,e);return this}setColorName(t,e=hn){const n=d_[t.toLowerCase()];return n!==void 0?this.setHex(n,e):console.warn("THREE.Color: Unknown color "+t),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(t){return this.r=t.r,this.g=t.g,this.b=t.b,this}copySRGBToLinear(t){return this.r=zr(t.r),this.g=zr(t.g),this.b=zr(t.b),this}copyLinearToSRGB(t){return this.r=Zl(t.r),this.g=Zl(t.g),this.b=Zl(t.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(t=hn){return me.fromWorkingColorSpace(xn.copy(this),t),Math.round($e(xn.r*255,0,255))*65536+Math.round($e(xn.g*255,0,255))*256+Math.round($e(xn.b*255,0,255))}getHexString(t=hn){return("000000"+this.getHex(t).toString(16)).slice(-6)}getHSL(t,e=me.workingColorSpace){me.fromWorkingColorSpace(xn.copy(this),e);const n=xn.r,s=xn.g,r=xn.b,o=Math.max(n,s,r),a=Math.min(n,s,r);let c,l;const h=(a+o)/2;if(a===o)c=0,l=0;else{const d=o-a;switch(l=h<=.5?d/(o+a):d/(2-o-a),o){case n:c=(s-r)/d+(s<r?6:0);break;case s:c=(r-n)/d+2;break;case r:c=(n-s)/d+4;break}c/=6}return t.h=c,t.s=l,t.l=h,t}getRGB(t,e=me.workingColorSpace){return me.fromWorkingColorSpace(xn.copy(this),e),t.r=xn.r,t.g=xn.g,t.b=xn.b,t}getStyle(t=hn){me.fromWorkingColorSpace(xn.copy(this),t);const e=xn.r,n=xn.g,s=xn.b;return t!==hn?`color(${t} ${e.toFixed(3)} ${n.toFixed(3)} ${s.toFixed(3)})`:`rgb(${Math.round(e*255)},${Math.round(n*255)},${Math.round(s*255)})`}offsetHSL(t,e,n){return this.getHSL(Zi),this.setHSL(Zi.h+t,Zi.s+e,Zi.l+n)}add(t){return this.r+=t.r,this.g+=t.g,this.b+=t.b,this}addColors(t,e){return this.r=t.r+e.r,this.g=t.g+e.g,this.b=t.b+e.b,this}addScalar(t){return this.r+=t,this.g+=t,this.b+=t,this}sub(t){return this.r=Math.max(0,this.r-t.r),this.g=Math.max(0,this.g-t.g),this.b=Math.max(0,this.b-t.b),this}multiply(t){return this.r*=t.r,this.g*=t.g,this.b*=t.b,this}multiplyScalar(t){return this.r*=t,this.g*=t,this.b*=t,this}lerp(t,e){return this.r+=(t.r-this.r)*e,this.g+=(t.g-this.g)*e,this.b+=(t.b-this.b)*e,this}lerpColors(t,e,n){return this.r=t.r+(e.r-t.r)*n,this.g=t.g+(e.g-t.g)*n,this.b=t.b+(e.b-t.b)*n,this}lerpHSL(t,e){this.getHSL(Zi),t.getHSL(ic);const n=Zo(Zi.h,ic.h,e),s=Zo(Zi.s,ic.s,e),r=Zo(Zi.l,ic.l,e);return this.setHSL(n,s,r),this}setFromVector3(t){return this.r=t.x,this.g=t.y,this.b=t.z,this}applyMatrix3(t){const e=this.r,n=this.g,s=this.b,r=t.elements;return this.r=r[0]*e+r[3]*n+r[6]*s,this.g=r[1]*e+r[4]*n+r[7]*s,this.b=r[2]*e+r[5]*n+r[8]*s,this}equals(t){return t.r===this.r&&t.g===this.g&&t.b===this.b}fromArray(t,e=0){return this.r=t[e],this.g=t[e+1],this.b=t[e+2],this}toArray(t=[],e=0){return t[e]=this.r,t[e+1]=this.g,t[e+2]=this.b,t}fromBufferAttribute(t,e){return this.r=t.getX(e),this.g=t.getY(e),this.b=t.getZ(e),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}}const xn=new It;It.NAMES=d_;let kx=0;class jn extends Ms{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:kx++}),this.uuid=qn(),this.name="",this.type="Material",this.blending=Br,this.side=yi,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=Ju,this.blendDst=Zu,this.blendEquation=Vs,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new It(0,0,0),this.blendAlpha=0,this.depthFunc=qr,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=ip,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=hr,this.stencilZFail=hr,this.stencilZPass=hr,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(t){this._alphaTest>0!=t>0&&this.version++,this._alphaTest=t}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(t){if(t!==void 0)for(const e in t){const n=t[e];if(n===void 0){console.warn(`THREE.Material: parameter '${e}' has value of undefined.`);continue}const s=this[e];if(s===void 0){console.warn(`THREE.Material: '${e}' is not a property of THREE.${this.type}.`);continue}s&&s.isColor?s.set(n):s&&s.isVector3&&n&&n.isVector3?s.copy(n):this[e]=n}}toJSON(t){const e=t===void 0||typeof t=="string";e&&(t={textures:{},images:{}});const n={metadata:{version:4.6,type:"Material",generator:"Material.toJSON"}};n.uuid=this.uuid,n.type=this.type,this.name!==""&&(n.name=this.name),this.color&&this.color.isColor&&(n.color=this.color.getHex()),this.roughness!==void 0&&(n.roughness=this.roughness),this.metalness!==void 0&&(n.metalness=this.metalness),this.sheen!==void 0&&(n.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(n.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(n.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(n.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(n.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(n.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(n.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(n.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(n.shininess=this.shininess),this.clearcoat!==void 0&&(n.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(n.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(n.clearcoatMap=this.clearcoatMap.toJSON(t).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(n.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(t).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(n.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(t).uuid,n.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.dispersion!==void 0&&(n.dispersion=this.dispersion),this.iridescence!==void 0&&(n.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(n.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(n.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(n.iridescenceMap=this.iridescenceMap.toJSON(t).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(n.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(t).uuid),this.anisotropy!==void 0&&(n.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(n.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(n.anisotropyMap=this.anisotropyMap.toJSON(t).uuid),this.map&&this.map.isTexture&&(n.map=this.map.toJSON(t).uuid),this.matcap&&this.matcap.isTexture&&(n.matcap=this.matcap.toJSON(t).uuid),this.alphaMap&&this.alphaMap.isTexture&&(n.alphaMap=this.alphaMap.toJSON(t).uuid),this.lightMap&&this.lightMap.isTexture&&(n.lightMap=this.lightMap.toJSON(t).uuid,n.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(n.aoMap=this.aoMap.toJSON(t).uuid,n.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(n.bumpMap=this.bumpMap.toJSON(t).uuid,n.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(n.normalMap=this.normalMap.toJSON(t).uuid,n.normalMapType=this.normalMapType,n.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(n.displacementMap=this.displacementMap.toJSON(t).uuid,n.displacementScale=this.displacementScale,n.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(n.roughnessMap=this.roughnessMap.toJSON(t).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(n.metalnessMap=this.metalnessMap.toJSON(t).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(n.emissiveMap=this.emissiveMap.toJSON(t).uuid),this.specularMap&&this.specularMap.isTexture&&(n.specularMap=this.specularMap.toJSON(t).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(n.specularIntensityMap=this.specularIntensityMap.toJSON(t).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(n.specularColorMap=this.specularColorMap.toJSON(t).uuid),this.envMap&&this.envMap.isTexture&&(n.envMap=this.envMap.toJSON(t).uuid,this.combine!==void 0&&(n.combine=this.combine)),this.envMapRotation!==void 0&&(n.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(n.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(n.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(n.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(n.gradientMap=this.gradientMap.toJSON(t).uuid),this.transmission!==void 0&&(n.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(n.transmissionMap=this.transmissionMap.toJSON(t).uuid),this.thickness!==void 0&&(n.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(n.thicknessMap=this.thicknessMap.toJSON(t).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(n.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(n.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(n.size=this.size),this.shadowSide!==null&&(n.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(n.sizeAttenuation=this.sizeAttenuation),this.blending!==Br&&(n.blending=this.blending),this.side!==yi&&(n.side=this.side),this.vertexColors===!0&&(n.vertexColors=!0),this.opacity<1&&(n.opacity=this.opacity),this.transparent===!0&&(n.transparent=!0),this.blendSrc!==Ju&&(n.blendSrc=this.blendSrc),this.blendDst!==Zu&&(n.blendDst=this.blendDst),this.blendEquation!==Vs&&(n.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(n.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(n.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(n.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(n.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(n.blendAlpha=this.blendAlpha),this.depthFunc!==qr&&(n.depthFunc=this.depthFunc),this.depthTest===!1&&(n.depthTest=this.depthTest),this.depthWrite===!1&&(n.depthWrite=this.depthWrite),this.colorWrite===!1&&(n.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(n.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==ip&&(n.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(n.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(n.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==hr&&(n.stencilFail=this.stencilFail),this.stencilZFail!==hr&&(n.stencilZFail=this.stencilZFail),this.stencilZPass!==hr&&(n.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(n.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(n.rotation=this.rotation),this.polygonOffset===!0&&(n.polygonOffset=!0),this.polygonOffsetFactor!==0&&(n.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(n.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(n.linewidth=this.linewidth),this.dashSize!==void 0&&(n.dashSize=this.dashSize),this.gapSize!==void 0&&(n.gapSize=this.gapSize),this.scale!==void 0&&(n.scale=this.scale),this.dithering===!0&&(n.dithering=!0),this.alphaTest>0&&(n.alphaTest=this.alphaTest),this.alphaHash===!0&&(n.alphaHash=!0),this.alphaToCoverage===!0&&(n.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(n.premultipliedAlpha=!0),this.forceSinglePass===!0&&(n.forceSinglePass=!0),this.wireframe===!0&&(n.wireframe=!0),this.wireframeLinewidth>1&&(n.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(n.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(n.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(n.flatShading=!0),this.visible===!1&&(n.visible=!1),this.toneMapped===!1&&(n.toneMapped=!1),this.fog===!1&&(n.fog=!1),Object.keys(this.userData).length>0&&(n.userData=this.userData);function s(r){const o=[];for(const a in r){const c=r[a];delete c.metadata,o.push(c)}return o}if(e){const r=s(t.textures),o=s(t.images);r.length>0&&(n.textures=r),o.length>0&&(n.images=o)}return n}clone(){return new this.constructor().copy(this)}copy(t){this.name=t.name,this.blending=t.blending,this.side=t.side,this.vertexColors=t.vertexColors,this.opacity=t.opacity,this.transparent=t.transparent,this.blendSrc=t.blendSrc,this.blendDst=t.blendDst,this.blendEquation=t.blendEquation,this.blendSrcAlpha=t.blendSrcAlpha,this.blendDstAlpha=t.blendDstAlpha,this.blendEquationAlpha=t.blendEquationAlpha,this.blendColor.copy(t.blendColor),this.blendAlpha=t.blendAlpha,this.depthFunc=t.depthFunc,this.depthTest=t.depthTest,this.depthWrite=t.depthWrite,this.stencilWriteMask=t.stencilWriteMask,this.stencilFunc=t.stencilFunc,this.stencilRef=t.stencilRef,this.stencilFuncMask=t.stencilFuncMask,this.stencilFail=t.stencilFail,this.stencilZFail=t.stencilZFail,this.stencilZPass=t.stencilZPass,this.stencilWrite=t.stencilWrite;const e=t.clippingPlanes;let n=null;if(e!==null){const s=e.length;n=new Array(s);for(let r=0;r!==s;++r)n[r]=e[r].clone()}return this.clippingPlanes=n,this.clipIntersection=t.clipIntersection,this.clipShadows=t.clipShadows,this.shadowSide=t.shadowSide,this.colorWrite=t.colorWrite,this.precision=t.precision,this.polygonOffset=t.polygonOffset,this.polygonOffsetFactor=t.polygonOffsetFactor,this.polygonOffsetUnits=t.polygonOffsetUnits,this.dithering=t.dithering,this.alphaTest=t.alphaTest,this.alphaHash=t.alphaHash,this.alphaToCoverage=t.alphaToCoverage,this.premultipliedAlpha=t.premultipliedAlpha,this.forceSinglePass=t.forceSinglePass,this.visible=t.visible,this.toneMapped=t.toneMapped,this.userData=JSON.parse(JSON.stringify(t.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(t){t===!0&&this.version++}onBuild(){console.warn("Material: onBuild() has been removed.")}}class ks extends jn{constructor(t){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new It(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new ai,this.combine=md,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.specularMap=t.specularMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.combine=t.combine,this.reflectivity=t.reflectivity,this.refractionRatio=t.refractionRatio,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.fog=t.fog,this}}const He=new O,sc=new dt;class An{constructor(t,e,n=!1){if(Array.isArray(t))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,this.name="",this.array=t,this.itemSize=e,this.count=t!==void 0?t.length/e:0,this.normalized=n,this.usage=Uh,this.updateRanges=[],this.gpuType=si,this.version=0}onUploadCallback(){}set needsUpdate(t){t===!0&&this.version++}setUsage(t){return this.usage=t,this}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}copy(t){return this.name=t.name,this.array=new t.array.constructor(t.array),this.itemSize=t.itemSize,this.count=t.count,this.normalized=t.normalized,this.usage=t.usage,this.gpuType=t.gpuType,this}copyAt(t,e,n){t*=this.itemSize,n*=e.itemSize;for(let s=0,r=this.itemSize;s<r;s++)this.array[t+s]=e.array[n+s];return this}copyArray(t){return this.array.set(t),this}applyMatrix3(t){if(this.itemSize===2)for(let e=0,n=this.count;e<n;e++)sc.fromBufferAttribute(this,e),sc.applyMatrix3(t),this.setXY(e,sc.x,sc.y);else if(this.itemSize===3)for(let e=0,n=this.count;e<n;e++)He.fromBufferAttribute(this,e),He.applyMatrix3(t),this.setXYZ(e,He.x,He.y,He.z);return this}applyMatrix4(t){for(let e=0,n=this.count;e<n;e++)He.fromBufferAttribute(this,e),He.applyMatrix4(t),this.setXYZ(e,He.x,He.y,He.z);return this}applyNormalMatrix(t){for(let e=0,n=this.count;e<n;e++)He.fromBufferAttribute(this,e),He.applyNormalMatrix(t),this.setXYZ(e,He.x,He.y,He.z);return this}transformDirection(t){for(let e=0,n=this.count;e<n;e++)He.fromBufferAttribute(this,e),He.transformDirection(t),this.setXYZ(e,He.x,He.y,He.z);return this}set(t,e=0){return this.array.set(t,e),this}getComponent(t,e){let n=this.array[t*this.itemSize+e];return this.normalized&&(n=ni(n,this.array)),n}setComponent(t,e,n){return this.normalized&&(n=xe(n,this.array)),this.array[t*this.itemSize+e]=n,this}getX(t){let e=this.array[t*this.itemSize];return this.normalized&&(e=ni(e,this.array)),e}setX(t,e){return this.normalized&&(e=xe(e,this.array)),this.array[t*this.itemSize]=e,this}getY(t){let e=this.array[t*this.itemSize+1];return this.normalized&&(e=ni(e,this.array)),e}setY(t,e){return this.normalized&&(e=xe(e,this.array)),this.array[t*this.itemSize+1]=e,this}getZ(t){let e=this.array[t*this.itemSize+2];return this.normalized&&(e=ni(e,this.array)),e}setZ(t,e){return this.normalized&&(e=xe(e,this.array)),this.array[t*this.itemSize+2]=e,this}getW(t){let e=this.array[t*this.itemSize+3];return this.normalized&&(e=ni(e,this.array)),e}setW(t,e){return this.normalized&&(e=xe(e,this.array)),this.array[t*this.itemSize+3]=e,this}setXY(t,e,n){return t*=this.itemSize,this.normalized&&(e=xe(e,this.array),n=xe(n,this.array)),this.array[t+0]=e,this.array[t+1]=n,this}setXYZ(t,e,n,s){return t*=this.itemSize,this.normalized&&(e=xe(e,this.array),n=xe(n,this.array),s=xe(s,this.array)),this.array[t+0]=e,this.array[t+1]=n,this.array[t+2]=s,this}setXYZW(t,e,n,s,r){return t*=this.itemSize,this.normalized&&(e=xe(e,this.array),n=xe(n,this.array),s=xe(s,this.array),r=xe(r,this.array)),this.array[t+0]=e,this.array[t+1]=n,this.array[t+2]=s,this.array[t+3]=r,this}onUpload(t){return this.onUploadCallback=t,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){const t={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(t.name=this.name),this.usage!==Uh&&(t.usage=this.usage),t}}class f_ extends An{constructor(t,e,n){super(new Uint16Array(t),e,n)}}class p_ extends An{constructor(t,e,n){super(new Uint32Array(t),e,n)}}class we extends An{constructor(t,e,n){super(new Float32Array(t),e,n)}}let zx=0;const kn=new Gt,mu=new Me,Er=new O,On=new Ti,No=new Ti,sn=new O;class mn extends Ms{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:zx++}),this.uuid=qn(),this.name="",this.type="BufferGeometry",this.index=null,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(t){return Array.isArray(t)?this.index=new(l_(t)?p_:f_)(t,1):this.index=t,this}getAttribute(t){return this.attributes[t]}setAttribute(t,e){return this.attributes[t]=e,this}deleteAttribute(t){return delete this.attributes[t],this}hasAttribute(t){return this.attributes[t]!==void 0}addGroup(t,e,n=0){this.groups.push({start:t,count:e,materialIndex:n})}clearGroups(){this.groups=[]}setDrawRange(t,e){this.drawRange.start=t,this.drawRange.count=e}applyMatrix4(t){const e=this.attributes.position;e!==void 0&&(e.applyMatrix4(t),e.needsUpdate=!0);const n=this.attributes.normal;if(n!==void 0){const r=new Jt().getNormalMatrix(t);n.applyNormalMatrix(r),n.needsUpdate=!0}const s=this.attributes.tangent;return s!==void 0&&(s.transformDirection(t),s.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(t){return kn.makeRotationFromQuaternion(t),this.applyMatrix4(kn),this}rotateX(t){return kn.makeRotationX(t),this.applyMatrix4(kn),this}rotateY(t){return kn.makeRotationY(t),this.applyMatrix4(kn),this}rotateZ(t){return kn.makeRotationZ(t),this.applyMatrix4(kn),this}translate(t,e,n){return kn.makeTranslation(t,e,n),this.applyMatrix4(kn),this}scale(t,e,n){return kn.makeScale(t,e,n),this.applyMatrix4(kn),this}lookAt(t){return mu.lookAt(t),mu.updateMatrix(),this.applyMatrix4(mu.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(Er).negate(),this.translate(Er.x,Er.y,Er.z),this}setFromPoints(t){const e=[];for(let n=0,s=t.length;n<s;n++){const r=t[n];e.push(r.x,r.y,r.z||0)}return this.setAttribute("position",new we(e,3)),this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new Ti);const t=this.attributes.position,e=this.morphAttributes.position;if(t&&t.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new O(-1/0,-1/0,-1/0),new O(1/0,1/0,1/0));return}if(t!==void 0){if(this.boundingBox.setFromBufferAttribute(t),e)for(let n=0,s=e.length;n<s;n++){const r=e[n];On.setFromBufferAttribute(r),this.morphTargetsRelative?(sn.addVectors(this.boundingBox.min,On.min),this.boundingBox.expandByPoint(sn),sn.addVectors(this.boundingBox.max,On.max),this.boundingBox.expandByPoint(sn)):(this.boundingBox.expandByPoint(On.min),this.boundingBox.expandByPoint(On.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&console.error('THREE.BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new Si);const t=this.attributes.position,e=this.morphAttributes.position;if(t&&t.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new O,1/0);return}if(t){const n=this.boundingSphere.center;if(On.setFromBufferAttribute(t),e)for(let r=0,o=e.length;r<o;r++){const a=e[r];No.setFromBufferAttribute(a),this.morphTargetsRelative?(sn.addVectors(On.min,No.min),On.expandByPoint(sn),sn.addVectors(On.max,No.max),On.expandByPoint(sn)):(On.expandByPoint(No.min),On.expandByPoint(No.max))}On.getCenter(n);let s=0;for(let r=0,o=t.count;r<o;r++)sn.fromBufferAttribute(t,r),s=Math.max(s,n.distanceToSquared(sn));if(e)for(let r=0,o=e.length;r<o;r++){const a=e[r],c=this.morphTargetsRelative;for(let l=0,h=a.count;l<h;l++)sn.fromBufferAttribute(a,l),c&&(Er.fromBufferAttribute(t,l),sn.add(Er)),s=Math.max(s,n.distanceToSquared(sn))}this.boundingSphere.radius=Math.sqrt(s),isNaN(this.boundingSphere.radius)&&console.error('THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){const t=this.index,e=this.attributes;if(t===null||e.position===void 0||e.normal===void 0||e.uv===void 0){console.error("THREE.BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}const n=e.position,s=e.normal,r=e.uv;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new An(new Float32Array(4*n.count),4));const o=this.getAttribute("tangent"),a=[],c=[];for(let w=0;w<n.count;w++)a[w]=new O,c[w]=new O;const l=new O,h=new O,d=new O,f=new dt,p=new dt,v=new dt,x=new O,m=new O;function _(w,C,y){l.fromBufferAttribute(n,w),h.fromBufferAttribute(n,C),d.fromBufferAttribute(n,y),f.fromBufferAttribute(r,w),p.fromBufferAttribute(r,C),v.fromBufferAttribute(r,y),h.sub(l),d.sub(l),p.sub(f),v.sub(f);const E=1/(p.x*v.y-v.x*p.y);isFinite(E)&&(x.copy(h).multiplyScalar(v.y).addScaledVector(d,-p.y).multiplyScalar(E),m.copy(d).multiplyScalar(p.x).addScaledVector(h,-v.x).multiplyScalar(E),a[w].add(x),a[C].add(x),a[y].add(x),c[w].add(m),c[C].add(m),c[y].add(m))}let A=this.groups;A.length===0&&(A=[{start:0,count:t.count}]);for(let w=0,C=A.length;w<C;++w){const y=A[w],E=y.start,L=y.count;for(let R=E,q=E+L;R<q;R+=3)_(t.getX(R+0),t.getX(R+1),t.getX(R+2))}const S=new O,b=new O,F=new O,N=new O;function M(w){F.fromBufferAttribute(s,w),N.copy(F);const C=a[w];S.copy(C),S.sub(F.multiplyScalar(F.dot(C))).normalize(),b.crossVectors(N,C);const E=b.dot(c[w])<0?-1:1;o.setXYZW(w,S.x,S.y,S.z,E)}for(let w=0,C=A.length;w<C;++w){const y=A[w],E=y.start,L=y.count;for(let R=E,q=E+L;R<q;R+=3)M(t.getX(R+0)),M(t.getX(R+1)),M(t.getX(R+2))}}computeVertexNormals(){const t=this.index,e=this.getAttribute("position");if(e!==void 0){let n=this.getAttribute("normal");if(n===void 0)n=new An(new Float32Array(e.count*3),3),this.setAttribute("normal",n);else for(let f=0,p=n.count;f<p;f++)n.setXYZ(f,0,0,0);const s=new O,r=new O,o=new O,a=new O,c=new O,l=new O,h=new O,d=new O;if(t)for(let f=0,p=t.count;f<p;f+=3){const v=t.getX(f+0),x=t.getX(f+1),m=t.getX(f+2);s.fromBufferAttribute(e,v),r.fromBufferAttribute(e,x),o.fromBufferAttribute(e,m),h.subVectors(o,r),d.subVectors(s,r),h.cross(d),a.fromBufferAttribute(n,v),c.fromBufferAttribute(n,x),l.fromBufferAttribute(n,m),a.add(h),c.add(h),l.add(h),n.setXYZ(v,a.x,a.y,a.z),n.setXYZ(x,c.x,c.y,c.z),n.setXYZ(m,l.x,l.y,l.z)}else for(let f=0,p=e.count;f<p;f+=3)s.fromBufferAttribute(e,f+0),r.fromBufferAttribute(e,f+1),o.fromBufferAttribute(e,f+2),h.subVectors(o,r),d.subVectors(s,r),h.cross(d),n.setXYZ(f+0,h.x,h.y,h.z),n.setXYZ(f+1,h.x,h.y,h.z),n.setXYZ(f+2,h.x,h.y,h.z);this.normalizeNormals(),n.needsUpdate=!0}}normalizeNormals(){const t=this.attributes.normal;for(let e=0,n=t.count;e<n;e++)sn.fromBufferAttribute(t,e),sn.normalize(),t.setXYZ(e,sn.x,sn.y,sn.z)}toNonIndexed(){function t(a,c){const l=a.array,h=a.itemSize,d=a.normalized,f=new l.constructor(c.length*h);let p=0,v=0;for(let x=0,m=c.length;x<m;x++){a.isInterleavedBufferAttribute?p=c[x]*a.data.stride+a.offset:p=c[x]*h;for(let _=0;_<h;_++)f[v++]=l[p++]}return new An(f,h,d)}if(this.index===null)return console.warn("THREE.BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;const e=new mn,n=this.index.array,s=this.attributes;for(const a in s){const c=s[a],l=t(c,n);e.setAttribute(a,l)}const r=this.morphAttributes;for(const a in r){const c=[],l=r[a];for(let h=0,d=l.length;h<d;h++){const f=l[h],p=t(f,n);c.push(p)}e.morphAttributes[a]=c}e.morphTargetsRelative=this.morphTargetsRelative;const o=this.groups;for(let a=0,c=o.length;a<c;a++){const l=o[a];e.addGroup(l.start,l.count,l.materialIndex)}return e}toJSON(){const t={metadata:{version:4.6,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(t.uuid=this.uuid,t.type=this.type,this.name!==""&&(t.name=this.name),Object.keys(this.userData).length>0&&(t.userData=this.userData),this.parameters!==void 0){const c=this.parameters;for(const l in c)c[l]!==void 0&&(t[l]=c[l]);return t}t.data={attributes:{}};const e=this.index;e!==null&&(t.data.index={type:e.array.constructor.name,array:Array.prototype.slice.call(e.array)});const n=this.attributes;for(const c in n){const l=n[c];t.data.attributes[c]=l.toJSON(t.data)}const s={};let r=!1;for(const c in this.morphAttributes){const l=this.morphAttributes[c],h=[];for(let d=0,f=l.length;d<f;d++){const p=l[d];h.push(p.toJSON(t.data))}h.length>0&&(s[c]=h,r=!0)}r&&(t.data.morphAttributes=s,t.data.morphTargetsRelative=this.morphTargetsRelative);const o=this.groups;o.length>0&&(t.data.groups=JSON.parse(JSON.stringify(o)));const a=this.boundingSphere;return a!==null&&(t.data.boundingSphere={center:a.center.toArray(),radius:a.radius}),t}clone(){return new this.constructor().copy(this)}copy(t){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;const e={};this.name=t.name;const n=t.index;n!==null&&this.setIndex(n.clone(e));const s=t.attributes;for(const l in s){const h=s[l];this.setAttribute(l,h.clone(e))}const r=t.morphAttributes;for(const l in r){const h=[],d=r[l];for(let f=0,p=d.length;f<p;f++)h.push(d[f].clone(e));this.morphAttributes[l]=h}this.morphTargetsRelative=t.morphTargetsRelative;const o=t.groups;for(let l=0,h=o.length;l<h;l++){const d=o[l];this.addGroup(d.start,d.count,d.materialIndex)}const a=t.boundingBox;a!==null&&(this.boundingBox=a.clone());const c=t.boundingSphere;return c!==null&&(this.boundingSphere=c.clone()),this.drawRange.start=t.drawRange.start,this.drawRange.count=t.drawRange.count,this.userData=t.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}}const vp=new Gt,Cs=new Ca,rc=new Si,yp=new O,oc=new O,ac=new O,cc=new O,gu=new O,lc=new O,xp=new O,uc=new O;class ve extends Me{constructor(t=new mn,e=new ks){super(),this.isMesh=!0,this.type="Mesh",this.geometry=t,this.material=e,this.updateMorphTargets()}copy(t,e){return super.copy(t,e),t.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=t.morphTargetInfluences.slice()),t.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},t.morphTargetDictionary)),this.material=Array.isArray(t.material)?t.material.slice():t.material,this.geometry=t.geometry,this}updateMorphTargets(){const e=this.geometry.morphAttributes,n=Object.keys(e);if(n.length>0){const s=e[n[0]];if(s!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,o=s.length;r<o;r++){const a=s[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=r}}}}getVertexPosition(t,e){const n=this.geometry,s=n.attributes.position,r=n.morphAttributes.position,o=n.morphTargetsRelative;e.fromBufferAttribute(s,t);const a=this.morphTargetInfluences;if(r&&a){lc.set(0,0,0);for(let c=0,l=r.length;c<l;c++){const h=a[c],d=r[c];h!==0&&(gu.fromBufferAttribute(d,t),o?lc.addScaledVector(gu,h):lc.addScaledVector(gu.sub(e),h))}e.add(lc)}return e}raycast(t,e){const n=this.geometry,s=this.material,r=this.matrixWorld;s!==void 0&&(n.boundingSphere===null&&n.computeBoundingSphere(),rc.copy(n.boundingSphere),rc.applyMatrix4(r),Cs.copy(t.ray).recast(t.near),!(rc.containsPoint(Cs.origin)===!1&&(Cs.intersectSphere(rc,yp)===null||Cs.origin.distanceToSquared(yp)>(t.far-t.near)**2))&&(vp.copy(r).invert(),Cs.copy(t.ray).applyMatrix4(vp),!(n.boundingBox!==null&&Cs.intersectsBox(n.boundingBox)===!1)&&this._computeIntersections(t,e,Cs)))}_computeIntersections(t,e,n){let s;const r=this.geometry,o=this.material,a=r.index,c=r.attributes.position,l=r.attributes.uv,h=r.attributes.uv1,d=r.attributes.normal,f=r.groups,p=r.drawRange;if(a!==null)if(Array.isArray(o))for(let v=0,x=f.length;v<x;v++){const m=f[v],_=o[m.materialIndex],A=Math.max(m.start,p.start),S=Math.min(a.count,Math.min(m.start+m.count,p.start+p.count));for(let b=A,F=S;b<F;b+=3){const N=a.getX(b),M=a.getX(b+1),w=a.getX(b+2);s=hc(this,_,t,n,l,h,d,N,M,w),s&&(s.faceIndex=Math.floor(b/3),s.face.materialIndex=m.materialIndex,e.push(s))}}else{const v=Math.max(0,p.start),x=Math.min(a.count,p.start+p.count);for(let m=v,_=x;m<_;m+=3){const A=a.getX(m),S=a.getX(m+1),b=a.getX(m+2);s=hc(this,o,t,n,l,h,d,A,S,b),s&&(s.faceIndex=Math.floor(m/3),e.push(s))}}else if(c!==void 0)if(Array.isArray(o))for(let v=0,x=f.length;v<x;v++){const m=f[v],_=o[m.materialIndex],A=Math.max(m.start,p.start),S=Math.min(c.count,Math.min(m.start+m.count,p.start+p.count));for(let b=A,F=S;b<F;b+=3){const N=b,M=b+1,w=b+2;s=hc(this,_,t,n,l,h,d,N,M,w),s&&(s.faceIndex=Math.floor(b/3),s.face.materialIndex=m.materialIndex,e.push(s))}}else{const v=Math.max(0,p.start),x=Math.min(c.count,p.start+p.count);for(let m=v,_=x;m<_;m+=3){const A=m,S=m+1,b=m+2;s=hc(this,o,t,n,l,h,d,A,S,b),s&&(s.faceIndex=Math.floor(m/3),e.push(s))}}}}function Hx(i,t,e,n,s,r,o,a){let c;if(t.side===Dn?c=n.intersectTriangle(o,r,s,!0,a):c=n.intersectTriangle(s,r,o,t.side===yi,a),c===null)return null;uc.copy(a),uc.applyMatrix4(i.matrixWorld);const l=e.ray.origin.distanceTo(uc);return l<e.near||l>e.far?null:{distance:l,point:uc.clone(),object:i}}function hc(i,t,e,n,s,r,o,a,c,l){i.getVertexPosition(a,oc),i.getVertexPosition(c,ac),i.getVertexPosition(l,cc);const h=Hx(i,t,e,n,oc,ac,cc,xp);if(h){const d=new O;Hn.getBarycoord(xp,oc,ac,cc,d),s&&(h.uv=Hn.getInterpolatedAttribute(s,a,c,l,d,new dt)),r&&(h.uv1=Hn.getInterpolatedAttribute(r,a,c,l,d,new dt)),o&&(h.normal=Hn.getInterpolatedAttribute(o,a,c,l,d,new O),h.normal.dot(n.direction)>0&&h.normal.multiplyScalar(-1));const f={a,b:c,c:l,normal:new O,materialIndex:0};Hn.getNormal(oc,ac,cc,f.normal),h.face=f,h.barycoord=d}return h}class We extends mn{constructor(t=1,e=1,n=1,s=1,r=1,o=1){super(),this.type="BoxGeometry",this.parameters={width:t,height:e,depth:n,widthSegments:s,heightSegments:r,depthSegments:o};const a=this;s=Math.floor(s),r=Math.floor(r),o=Math.floor(o);const c=[],l=[],h=[],d=[];let f=0,p=0;v("z","y","x",-1,-1,n,e,t,o,r,0),v("z","y","x",1,-1,n,e,-t,o,r,1),v("x","z","y",1,1,t,n,e,s,o,2),v("x","z","y",1,-1,t,n,-e,s,o,3),v("x","y","z",1,-1,t,e,n,s,r,4),v("x","y","z",-1,-1,t,e,-n,s,r,5),this.setIndex(c),this.setAttribute("position",new we(l,3)),this.setAttribute("normal",new we(h,3)),this.setAttribute("uv",new we(d,2));function v(x,m,_,A,S,b,F,N,M,w,C){const y=b/M,E=F/w,L=b/2,R=F/2,q=N/2,nt=M+1,j=w+1;let ot=0,Y=0;const Et=new O;for(let Tt=0;Tt<j;Tt++){const Ct=Tt*E-R;for(let $t=0;$t<nt;$t++){const Ht=$t*y-L;Et[x]=Ht*A,Et[m]=Ct*S,Et[_]=q,l.push(Et.x,Et.y,Et.z),Et[x]=0,Et[m]=0,Et[_]=N>0?1:-1,h.push(Et.x,Et.y,Et.z),d.push($t/M),d.push(1-Tt/w),ot+=1}}for(let Tt=0;Tt<w;Tt++)for(let Ct=0;Ct<M;Ct++){const $t=f+Ct+nt*Tt,Ht=f+Ct+nt*(Tt+1),J=f+(Ct+1)+nt*(Tt+1),rt=f+(Ct+1)+nt*Tt;c.push($t,Ht,rt),c.push(Ht,J,rt),Y+=6}a.addGroup(p,Y,C),p+=Y,f+=ot}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new We(t.width,t.height,t.depth,t.widthSegments,t.heightSegments,t.depthSegments)}}function Zr(i){const t={};for(const e in i){t[e]={};for(const n in i[e]){const s=i[e][n];s&&(s.isColor||s.isMatrix3||s.isMatrix4||s.isVector2||s.isVector3||s.isVector4||s.isTexture||s.isQuaternion)?s.isRenderTargetTexture?(console.warn("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),t[e][n]=null):t[e][n]=s.clone():Array.isArray(s)?t[e][n]=s.slice():t[e][n]=s}}return t}function bn(i){const t={};for(let e=0;e<i.length;e++){const n=Zr(i[e]);for(const s in n)t[s]=n[s]}return t}function Gx(i){const t=[];for(let e=0;e<i.length;e++)t.push(i[e].clone());return t}function m_(i){const t=i.getRenderTarget();return t===null?i.outputColorSpace:t.isXRRenderTarget===!0?t.texture.colorSpace:me.workingColorSpace}const Wx={clone:Zr,merge:bn};var Xx=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,qx=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`;class ms extends jn{constructor(t){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=Xx,this.fragmentShader=qx,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,t!==void 0&&this.setValues(t)}copy(t){return super.copy(t),this.fragmentShader=t.fragmentShader,this.vertexShader=t.vertexShader,this.uniforms=Zr(t.uniforms),this.uniformsGroups=Gx(t.uniformsGroups),this.defines=Object.assign({},t.defines),this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.fog=t.fog,this.lights=t.lights,this.clipping=t.clipping,this.extensions=Object.assign({},t.extensions),this.glslVersion=t.glslVersion,this}toJSON(t){const e=super.toJSON(t);e.glslVersion=this.glslVersion,e.uniforms={};for(const s in this.uniforms){const o=this.uniforms[s].value;o&&o.isTexture?e.uniforms[s]={type:"t",value:o.toJSON(t).uuid}:o&&o.isColor?e.uniforms[s]={type:"c",value:o.getHex()}:o&&o.isVector2?e.uniforms[s]={type:"v2",value:o.toArray()}:o&&o.isVector3?e.uniforms[s]={type:"v3",value:o.toArray()}:o&&o.isVector4?e.uniforms[s]={type:"v4",value:o.toArray()}:o&&o.isMatrix3?e.uniforms[s]={type:"m3",value:o.toArray()}:o&&o.isMatrix4?e.uniforms[s]={type:"m4",value:o.toArray()}:e.uniforms[s]={value:o}}Object.keys(this.defines).length>0&&(e.defines=this.defines),e.vertexShader=this.vertexShader,e.fragmentShader=this.fragmentShader,e.lights=this.lights,e.clipping=this.clipping;const n={};for(const s in this.extensions)this.extensions[s]===!0&&(n[s]=!0);return Object.keys(n).length>0&&(e.extensions=n),e}}class g_ extends Me{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new Gt,this.projectionMatrix=new Gt,this.projectionMatrixInverse=new Gt,this.coordinateSystem=Vi}copy(t,e){return super.copy(t,e),this.matrixWorldInverse.copy(t.matrixWorldInverse),this.projectionMatrix.copy(t.projectionMatrix),this.projectionMatrixInverse.copy(t.projectionMatrixInverse),this.coordinateSystem=t.coordinateSystem,this}getWorldDirection(t){return super.getWorldDirection(t).negate()}updateMatrixWorld(t){super.updateMatrixWorld(t),this.matrixWorldInverse.copy(this.matrixWorld).invert()}updateWorldMatrix(t,e){super.updateWorldMatrix(t,e),this.matrixWorldInverse.copy(this.matrixWorld).invert()}clone(){return new this.constructor().copy(this)}}const Qi=new O,Ep=new dt,Tp=new dt;class Pn extends g_{constructor(t=50,e=1,n=.1,s=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=t,this.zoom=1,this.near=n,this.far=s,this.focus=10,this.aspect=e,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(t,e){return super.copy(t,e),this.fov=t.fov,this.zoom=t.zoom,this.near=t.near,this.far=t.far,this.focus=t.focus,this.aspect=t.aspect,this.view=t.view===null?null:Object.assign({},t.view),this.filmGauge=t.filmGauge,this.filmOffset=t.filmOffset,this}setFocalLength(t){const e=.5*this.getFilmHeight()/t;this.fov=Jr*2*Math.atan(e),this.updateProjectionMatrix()}getFocalLength(){const t=Math.tan(Jo*.5*this.fov);return .5*this.getFilmHeight()/t}getEffectiveFOV(){return Jr*2*Math.atan(Math.tan(Jo*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(t,e,n){Qi.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),e.set(Qi.x,Qi.y).multiplyScalar(-t/Qi.z),Qi.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(Qi.x,Qi.y).multiplyScalar(-t/Qi.z)}getViewSize(t,e){return this.getViewBounds(t,Ep,Tp),e.subVectors(Tp,Ep)}setViewOffset(t,e,n,s,r,o){this.aspect=t/e,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=t,this.view.fullHeight=e,this.view.offsetX=n,this.view.offsetY=s,this.view.width=r,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const t=this.near;let e=t*Math.tan(Jo*.5*this.fov)/this.zoom,n=2*e,s=this.aspect*n,r=-.5*s;const o=this.view;if(this.view!==null&&this.view.enabled){const c=o.fullWidth,l=o.fullHeight;r+=o.offsetX*s/c,e-=o.offsetY*n/l,s*=o.width/c,n*=o.height/l}const a=this.filmOffset;a!==0&&(r+=t*a/this.getFilmWidth()),this.projectionMatrix.makePerspective(r,r+s,e,e-n,t,this.far,this.coordinateSystem),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(t){const e=super.toJSON(t);return e.object.fov=this.fov,e.object.zoom=this.zoom,e.object.near=this.near,e.object.far=this.far,e.object.focus=this.focus,e.object.aspect=this.aspect,this.view!==null&&(e.object.view=Object.assign({},this.view)),e.object.filmGauge=this.filmGauge,e.object.filmOffset=this.filmOffset,e}}const Tr=-90,Sr=1;class jx extends Me{constructor(t,e,n){super(),this.type="CubeCamera",this.renderTarget=n,this.coordinateSystem=null,this.activeMipmapLevel=0;const s=new Pn(Tr,Sr,t,e);s.layers=this.layers,this.add(s);const r=new Pn(Tr,Sr,t,e);r.layers=this.layers,this.add(r);const o=new Pn(Tr,Sr,t,e);o.layers=this.layers,this.add(o);const a=new Pn(Tr,Sr,t,e);a.layers=this.layers,this.add(a);const c=new Pn(Tr,Sr,t,e);c.layers=this.layers,this.add(c);const l=new Pn(Tr,Sr,t,e);l.layers=this.layers,this.add(l)}updateCoordinateSystem(){const t=this.coordinateSystem,e=this.children.concat(),[n,s,r,o,a,c]=e;for(const l of e)this.remove(l);if(t===Vi)n.up.set(0,1,0),n.lookAt(1,0,0),s.up.set(0,1,0),s.lookAt(-1,0,0),r.up.set(0,0,-1),r.lookAt(0,1,0),o.up.set(0,0,1),o.lookAt(0,-1,0),a.up.set(0,1,0),a.lookAt(0,0,1),c.up.set(0,1,0),c.lookAt(0,0,-1);else if(t===el)n.up.set(0,-1,0),n.lookAt(-1,0,0),s.up.set(0,-1,0),s.lookAt(1,0,0),r.up.set(0,0,1),r.lookAt(0,1,0),o.up.set(0,0,-1),o.lookAt(0,-1,0),a.up.set(0,-1,0),a.lookAt(0,0,1),c.up.set(0,-1,0),c.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+t);for(const l of e)this.add(l),l.updateMatrixWorld()}update(t,e){this.parent===null&&this.updateMatrixWorld();const{renderTarget:n,activeMipmapLevel:s}=this;this.coordinateSystem!==t.coordinateSystem&&(this.coordinateSystem=t.coordinateSystem,this.updateCoordinateSystem());const[r,o,a,c,l,h]=this.children,d=t.getRenderTarget(),f=t.getActiveCubeFace(),p=t.getActiveMipmapLevel(),v=t.xr.enabled;t.xr.enabled=!1;const x=n.texture.generateMipmaps;n.texture.generateMipmaps=!1,t.setRenderTarget(n,0,s),t.render(e,r),t.setRenderTarget(n,1,s),t.render(e,o),t.setRenderTarget(n,2,s),t.render(e,a),t.setRenderTarget(n,3,s),t.render(e,c),t.setRenderTarget(n,4,s),t.render(e,l),n.texture.generateMipmaps=x,t.setRenderTarget(n,5,s),t.render(e,h),t.setRenderTarget(d,f,p),t.xr.enabled=v,n.texture.needsPMREMUpdate=!0}}class __ extends Ze{constructor(t,e,n,s,r,o,a,c,l,h){t=t!==void 0?t:[],e=e!==void 0?e:jr,super(t,e,n,s,r,o,a,c,l,h),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(t){this.image=t}}class Kx extends Ys{constructor(t=1,e={}){super(t,t,e),this.isWebGLCubeRenderTarget=!0;const n={width:t,height:t,depth:1},s=[n,n,n,n,n,n];this.texture=new __(s,e.mapping,e.wrapS,e.wrapT,e.magFilter,e.minFilter,e.format,e.type,e.anisotropy,e.colorSpace),this.texture.isRenderTargetTexture=!0,this.texture.generateMipmaps=e.generateMipmaps!==void 0?e.generateMipmaps:!1,this.texture.minFilter=e.minFilter!==void 0?e.minFilter:Fn}fromEquirectangularTexture(t,e){this.texture.type=e.type,this.texture.colorSpace=e.colorSpace,this.texture.generateMipmaps=e.generateMipmaps,this.texture.minFilter=e.minFilter,this.texture.magFilter=e.magFilter;const n={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},s=new We(5,5,5),r=new ms({name:"CubemapFromEquirect",uniforms:Zr(n.uniforms),vertexShader:n.vertexShader,fragmentShader:n.fragmentShader,side:Dn,blending:cs});r.uniforms.tEquirect.value=e;const o=new ve(s,r),a=e.minFilter;return e.minFilter===Fi&&(e.minFilter=Fn),new jx(1,10,this).update(t,o),e.minFilter=a,o.geometry.dispose(),o.material.dispose(),this}clear(t,e,n,s){const r=t.getRenderTarget();for(let o=0;o<6;o++)t.setRenderTarget(this,o),t.clear(e,n,s);t.setRenderTarget(r)}}const _u=new O,$x=new O,Yx=new Jt;class Us{constructor(t=new O(1,0,0),e=0){this.isPlane=!0,this.normal=t,this.constant=e}set(t,e){return this.normal.copy(t),this.constant=e,this}setComponents(t,e,n,s){return this.normal.set(t,e,n),this.constant=s,this}setFromNormalAndCoplanarPoint(t,e){return this.normal.copy(t),this.constant=-e.dot(this.normal),this}setFromCoplanarPoints(t,e,n){const s=_u.subVectors(n,e).cross($x.subVectors(t,e)).normalize();return this.setFromNormalAndCoplanarPoint(s,t),this}copy(t){return this.normal.copy(t.normal),this.constant=t.constant,this}normalize(){const t=1/this.normal.length();return this.normal.multiplyScalar(t),this.constant*=t,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(t){return this.normal.dot(t)+this.constant}distanceToSphere(t){return this.distanceToPoint(t.center)-t.radius}projectPoint(t,e){return e.copy(t).addScaledVector(this.normal,-this.distanceToPoint(t))}intersectLine(t,e){const n=t.delta(_u),s=this.normal.dot(n);if(s===0)return this.distanceToPoint(t.start)===0?e.copy(t.start):null;const r=-(t.start.dot(this.normal)+this.constant)/s;return r<0||r>1?null:e.copy(t.start).addScaledVector(n,r)}intersectsLine(t){const e=this.distanceToPoint(t.start),n=this.distanceToPoint(t.end);return e<0&&n>0||n<0&&e>0}intersectsBox(t){return t.intersectsPlane(this)}intersectsSphere(t){return t.intersectsPlane(this)}coplanarPoint(t){return t.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(t,e){const n=e||Yx.getNormalMatrix(t),s=this.coplanarPoint(_u).applyMatrix4(t),r=this.normal.applyMatrix3(n).normalize();return this.constant=-s.dot(r),this}translate(t){return this.constant-=t.dot(this.normal),this}equals(t){return t.normal.equals(this.normal)&&t.constant===this.constant}clone(){return new this.constructor().copy(this)}}const Ps=new Si,dc=new O;class Rd{constructor(t=new Us,e=new Us,n=new Us,s=new Us,r=new Us,o=new Us){this.planes=[t,e,n,s,r,o]}set(t,e,n,s,r,o){const a=this.planes;return a[0].copy(t),a[1].copy(e),a[2].copy(n),a[3].copy(s),a[4].copy(r),a[5].copy(o),this}copy(t){const e=this.planes;for(let n=0;n<6;n++)e[n].copy(t.planes[n]);return this}setFromProjectionMatrix(t,e=Vi){const n=this.planes,s=t.elements,r=s[0],o=s[1],a=s[2],c=s[3],l=s[4],h=s[5],d=s[6],f=s[7],p=s[8],v=s[9],x=s[10],m=s[11],_=s[12],A=s[13],S=s[14],b=s[15];if(n[0].setComponents(c-r,f-l,m-p,b-_).normalize(),n[1].setComponents(c+r,f+l,m+p,b+_).normalize(),n[2].setComponents(c+o,f+h,m+v,b+A).normalize(),n[3].setComponents(c-o,f-h,m-v,b-A).normalize(),n[4].setComponents(c-a,f-d,m-x,b-S).normalize(),e===Vi)n[5].setComponents(c+a,f+d,m+x,b+S).normalize();else if(e===el)n[5].setComponents(a,d,x,S).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+e);return this}intersectsObject(t){if(t.boundingSphere!==void 0)t.boundingSphere===null&&t.computeBoundingSphere(),Ps.copy(t.boundingSphere).applyMatrix4(t.matrixWorld);else{const e=t.geometry;e.boundingSphere===null&&e.computeBoundingSphere(),Ps.copy(e.boundingSphere).applyMatrix4(t.matrixWorld)}return this.intersectsSphere(Ps)}intersectsSprite(t){return Ps.center.set(0,0,0),Ps.radius=.7071067811865476,Ps.applyMatrix4(t.matrixWorld),this.intersectsSphere(Ps)}intersectsSphere(t){const e=this.planes,n=t.center,s=-t.radius;for(let r=0;r<6;r++)if(e[r].distanceToPoint(n)<s)return!1;return!0}intersectsBox(t){const e=this.planes;for(let n=0;n<6;n++){const s=e[n];if(dc.x=s.normal.x>0?t.max.x:t.min.x,dc.y=s.normal.y>0?t.max.y:t.min.y,dc.z=s.normal.z>0?t.max.z:t.min.z,s.distanceToPoint(dc)<0)return!1}return!0}containsPoint(t){const e=this.planes;for(let n=0;n<6;n++)if(e[n].distanceToPoint(t)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}}function v_(){let i=null,t=!1,e=null,n=null;function s(r,o){e(r,o),n=i.requestAnimationFrame(s)}return{start:function(){t!==!0&&e!==null&&(n=i.requestAnimationFrame(s),t=!0)},stop:function(){i.cancelAnimationFrame(n),t=!1},setAnimationLoop:function(r){e=r},setContext:function(r){i=r}}}function Jx(i){const t=new WeakMap;function e(a,c){const l=a.array,h=a.usage,d=l.byteLength,f=i.createBuffer();i.bindBuffer(c,f),i.bufferData(c,l,h),a.onUploadCallback();let p;if(l instanceof Float32Array)p=i.FLOAT;else if(l instanceof Uint16Array)a.isFloat16BufferAttribute?p=i.HALF_FLOAT:p=i.UNSIGNED_SHORT;else if(l instanceof Int16Array)p=i.SHORT;else if(l instanceof Uint32Array)p=i.UNSIGNED_INT;else if(l instanceof Int32Array)p=i.INT;else if(l instanceof Int8Array)p=i.BYTE;else if(l instanceof Uint8Array)p=i.UNSIGNED_BYTE;else if(l instanceof Uint8ClampedArray)p=i.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+l);return{buffer:f,type:p,bytesPerElement:l.BYTES_PER_ELEMENT,version:a.version,size:d}}function n(a,c,l){const h=c.array,d=c.updateRanges;if(i.bindBuffer(l,a),d.length===0)i.bufferSubData(l,0,h);else{d.sort((p,v)=>p.start-v.start);let f=0;for(let p=1;p<d.length;p++){const v=d[f],x=d[p];x.start<=v.start+v.count+1?v.count=Math.max(v.count,x.start+x.count-v.start):(++f,d[f]=x)}d.length=f+1;for(let p=0,v=d.length;p<v;p++){const x=d[p];i.bufferSubData(l,x.start*h.BYTES_PER_ELEMENT,h,x.start,x.count)}c.clearUpdateRanges()}c.onUploadCallback()}function s(a){return a.isInterleavedBufferAttribute&&(a=a.data),t.get(a)}function r(a){a.isInterleavedBufferAttribute&&(a=a.data);const c=t.get(a);c&&(i.deleteBuffer(c.buffer),t.delete(a))}function o(a,c){if(a.isInterleavedBufferAttribute&&(a=a.data),a.isGLBufferAttribute){const h=t.get(a);(!h||h.version<a.version)&&t.set(a,{buffer:a.buffer,type:a.type,bytesPerElement:a.elementSize,version:a.version});return}const l=t.get(a);if(l===void 0)t.set(a,e(a,c));else if(l.version<a.version){if(l.size!==a.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");n(l.buffer,a,c),l.version=a.version}}return{get:s,remove:r,update:o}}class us extends mn{constructor(t=1,e=1,n=1,s=1){super(),this.type="PlaneGeometry",this.parameters={width:t,height:e,widthSegments:n,heightSegments:s};const r=t/2,o=e/2,a=Math.floor(n),c=Math.floor(s),l=a+1,h=c+1,d=t/a,f=e/c,p=[],v=[],x=[],m=[];for(let _=0;_<h;_++){const A=_*f-o;for(let S=0;S<l;S++){const b=S*d-r;v.push(b,-A,0),x.push(0,0,1),m.push(S/a),m.push(1-_/c)}}for(let _=0;_<c;_++)for(let A=0;A<a;A++){const S=A+l*_,b=A+l*(_+1),F=A+1+l*(_+1),N=A+1+l*_;p.push(S,b,N),p.push(b,F,N)}this.setIndex(p),this.setAttribute("position",new we(v,3)),this.setAttribute("normal",new we(x,3)),this.setAttribute("uv",new we(m,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new us(t.width,t.height,t.widthSegments,t.heightSegments)}}var Zx=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,Qx=`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,tE=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,eE=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,nE=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,iE=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,sE=`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,rE=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,oE=`#ifdef USE_BATCHING
	#if ! defined( GL_ANGLE_multi_draw )
	#define gl_DrawID _gl_DrawID
	uniform int _gl_DrawID;
	#endif
	uniform highp sampler2D batchingTexture;
	uniform highp usampler2D batchingIdTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
	float getIndirectIndex( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		int x = i % size;
		int y = i / size;
		return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );
	}
#endif
#ifdef USE_BATCHING_COLOR
	uniform sampler2D batchingColorTexture;
	vec3 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 ).rgb;
	}
#endif`,aE=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,cE=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,lE=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,uE=`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,hE=`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,dE=`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,fE=`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`,pE=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,mE=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,gE=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,_E=`#if defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#elif defined( USE_COLOR )
	diffuseColor.rgb *= vColor;
#endif`,vE=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR )
	varying vec3 vColor;
#endif`,yE=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec3 vColor;
#endif`,xE=`#if defined( USE_COLOR_ALPHA )
	vColor = vec4( 1.0 );
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
	vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.xyz *= instanceColor.xyz;
#endif
#ifdef USE_BATCHING_COLOR
	vec3 batchingColor = getBatchingColor( getIndirectIndex( gl_DrawID ) );
	vColor.xyz *= batchingColor.xyz;
#endif`,EE=`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
vec3 inverseTransformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( vec4( dir, 0.0 ) * matrix ).xyz );
}
mat3 transposeMat3( const in mat3 m ) {
	mat3 tmp;
	tmp[ 0 ] = vec3( m[ 0 ].x, m[ 1 ].x, m[ 2 ].x );
	tmp[ 1 ] = vec3( m[ 0 ].y, m[ 1 ].y, m[ 2 ].y );
	tmp[ 2 ] = vec3( m[ 0 ].z, m[ 1 ].z, m[ 2 ].z );
	return tmp;
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,TE=`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,SE=`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
	#ifdef FLIP_SIDED
		transformedTangent = - transformedTangent;
	#endif
#endif`,AE=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,ME=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,wE=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,bE=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,RE="gl_FragColor = linearToOutputTexel( gl_FragColor );",IE=`
const mat3 LINEAR_SRGB_TO_LINEAR_DISPLAY_P3 = mat3(
	vec3( 0.8224621, 0.177538, 0.0 ),
	vec3( 0.0331941, 0.9668058, 0.0 ),
	vec3( 0.0170827, 0.0723974, 0.9105199 )
);
const mat3 LINEAR_DISPLAY_P3_TO_LINEAR_SRGB = mat3(
	vec3( 1.2249401, - 0.2249404, 0.0 ),
	vec3( - 0.0420569, 1.0420571, 0.0 ),
	vec3( - 0.0196376, - 0.0786361, 1.0982735 )
);
vec4 LinearSRGBToLinearDisplayP3( in vec4 value ) {
	return vec4( value.rgb * LINEAR_SRGB_TO_LINEAR_DISPLAY_P3, value.a );
}
vec4 LinearDisplayP3ToLinearSRGB( in vec4 value ) {
	return vec4( value.rgb * LINEAR_DISPLAY_P3_TO_LINEAR_SRGB, value.a );
}
vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,CE=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * vec3( flipEnvMap * reflectVec.x, reflectVec.yz ) );
	#else
		vec4 envColor = vec4( 0.0 );
	#endif
	#ifdef ENVMAP_BLENDING_MULTIPLY
		outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_MIX )
		outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_ADD )
		outgoingLight += envColor.xyz * specularStrength * reflectivity;
	#endif
#endif`,PE=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform float flipEnvMap;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
	
#endif`,DE=`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,LE=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,NE=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,UE=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,OE=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,FE=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,VE=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,BE=`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,kE=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,zE=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,HE=`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,GE=`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if ( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif`,WE=`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, roughness * roughness) );
			reflectVec = inverseTransformDirection( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
#endif`,XE=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,qE=`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,jE=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,KE=`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,$E=`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb * ( 1.0 - metalnessFactor );
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = mix( min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = mix( vec3( 0.04 ), diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.07, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,YE=`struct PhysicalMaterial {
	vec3 diffuseColor;
	float roughness;
	vec3 specularColor;
	float specularF90;
	float dispersion;
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		float v = 0.5 / ( gv + gl );
		return saturate(v);
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColor;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transposeMat3( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float a = roughness < 0.25 ? -339.2 * r2 + 161.4 * roughness - 25.9 : -8.48 * r2 + 14.3 * roughness - 9.95;
	float b = roughness < 0.25 ? 44.0 * r2 - 23.7 * roughness + 3.26 : 1.97 * r2 - 3.27 * roughness + 0.72;
	float DG = exp( a * dotNV + b ) + ( roughness < 0.25 ? 0.0 : 0.1 * ( roughness - 0.25 ) );
	return saturate( DG * RECIPROCAL_PI );
}
vec2 DFGApprox( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	const vec4 c0 = vec4( - 1, - 0.0275, - 0.572, 0.022 );
	const vec4 c1 = vec4( 1, 0.0425, 1.04, - 0.04 );
	vec4 r = roughness * c0 + c1;
	float a004 = min( r.x * r.x, exp2( - 9.28 * dotNV ) ) * r.x + r.y;
	vec2 fab = vec2( - 1.04, 1.04 ) * a004 + r.zw;
	return fab;
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColor * t2.x + ( vec3( 1.0 ) - material.specularColor ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseColor * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
	#endif
	reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
	#endif
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.iridescence, material.iridescenceFresnel, material.roughness, singleScattering, multiScattering );
	#else
		computeMultiscattering( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness, singleScattering, multiScattering );
	#endif
	vec3 totalScattering = singleScattering + multiScattering;
	vec3 diffuse = material.diffuseColor * ( 1.0 - max( max( totalScattering.r, totalScattering.g ), totalScattering.b ) );
	reflectedLight.indirectSpecular += radiance * singleScattering;
	reflectedLight.indirectSpecular += multiScattering * cosineWeightedIrradiance;
	reflectedLight.indirectDiffuse += diffuse * cosineWeightedIrradiance;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,JE=`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		material.iridescenceFresnel = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		material.iridescenceF0 = Schlick_to_F0( material.iridescenceFresnel, 1.0, dotNVi );
	}
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,ZE=`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
		iblIrradiance += getIBLIrradiance( geometryNormal );
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,QE=`#if defined( RE_IndirectDiffuse )
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,tT=`#if defined( USE_LOGDEPTHBUF )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,eT=`#if defined( USE_LOGDEPTHBUF )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,nT=`#ifdef USE_LOGDEPTHBUF
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,iT=`#ifdef USE_LOGDEPTHBUF
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,sT=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = vec4( mix( pow( sampledDiffuseColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), sampledDiffuseColor.rgb * 0.0773993808, vec3( lessThanEqual( sampledDiffuseColor.rgb, vec3( 0.04045 ) ) ) ), sampledDiffuseColor.w );
	
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,rT=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,oT=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,aT=`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,cT=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,lT=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,uT=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,hT=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,dT=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,fT=`#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	#endif
	uniform sampler2DArray morphTargetsTexture;
	uniform ivec2 morphTargetsTextureSize;
	vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
		int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
		int y = texelIndex / morphTargetsTextureSize.x;
		int x = texelIndex - y * morphTargetsTextureSize.x;
		ivec3 morphUV = ivec3( x, y, morphTargetIndex );
		return texelFetch( morphTargetsTexture, morphUV, 0 );
	}
#endif`,pT=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,mT=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,gT=`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,_T=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,vT=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,yT=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,xT=`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,ET=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,TT=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,ST=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,AT=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,MT=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,wT=`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if( v <= 0.0 )
		return vec4( 0., 0., 0., 0. );
	if( v >= 1.0 )
		return vec4( 1., 1., 1., 1. );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if( v <= 0.0 )
		return vec3( 0., 0., 0. );
	if( v >= 1.0 )
		return vec3( 1., 1., 1. );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if( v <= 0.0 )
		return vec2( 0., 0. );
	if( v >= 1.0 )
		return vec2( 1., 1. );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
	return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
	return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return depth * ( near - far ) - near;
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return ( near * far ) / ( ( far - near ) * depth - far );
}`,bT=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,RT=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,IT=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,CT=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,PT=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,DT=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,LT=`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform sampler2D pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	float texture2DCompare( sampler2D depths, vec2 uv, float compare ) {
		return step( compare, unpackRGBAToDepth( texture2D( depths, uv ) ) );
	}
	vec2 texture2DDistribution( sampler2D shadow, vec2 uv ) {
		return unpackRGBATo2Half( texture2D( shadow, uv ) );
	}
	float VSMShadow (sampler2D shadow, vec2 uv, float compare ){
		float occlusion = 1.0;
		vec2 distribution = texture2DDistribution( shadow, uv );
		float hard_shadow = step( compare , distribution.x );
		if (hard_shadow != 1.0 ) {
			float distance = compare - distribution.x ;
			float variance = max( 0.00000, distribution.y * distribution.y );
			float softness_probability = variance / (variance + distance * distance );			softness_probability = clamp( ( softness_probability - 0.3 ) / ( 0.95 - 0.3 ), 0.0, 1.0 );			occlusion = clamp( max( hard_shadow, softness_probability ), 0.0, 1.0 );
		}
		return occlusion;
	}
	float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
		float shadow = 1.0;
		shadowCoord.xyz /= shadowCoord.w;
		shadowCoord.z += shadowBias;
		bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
		bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
		if ( frustumTest ) {
		#if defined( SHADOWMAP_TYPE_PCF )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx0 = - texelSize.x * shadowRadius;
			float dy0 = - texelSize.y * shadowRadius;
			float dx1 = + texelSize.x * shadowRadius;
			float dy1 = + texelSize.y * shadowRadius;
			float dx2 = dx0 / 2.0;
			float dy2 = dy0 / 2.0;
			float dx3 = dx1 / 2.0;
			float dy3 = dy1 / 2.0;
			shadow = (
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy1 ), shadowCoord.z )
			) * ( 1.0 / 17.0 );
		#elif defined( SHADOWMAP_TYPE_PCF_SOFT )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx = texelSize.x;
			float dy = texelSize.y;
			vec2 uv = shadowCoord.xy;
			vec2 f = fract( uv * shadowMapSize + 0.5 );
			uv -= f * texelSize;
			shadow = (
				texture2DCompare( shadowMap, uv, shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( dx, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( 0.0, dy ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + texelSize, shadowCoord.z ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, 0.0 ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 0.0 ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, dy ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( 0.0, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 0.0, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( texture2DCompare( shadowMap, uv + vec2( dx, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( dx, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( mix( texture2DCompare( shadowMap, uv + vec2( -dx, -dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, -dy ), shadowCoord.z ),
						  f.x ),
					 mix( texture2DCompare( shadowMap, uv + vec2( -dx, 2.0 * dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 2.0 * dy ), shadowCoord.z ),
						  f.x ),
					 f.y )
			) * ( 1.0 / 9.0 );
		#elif defined( SHADOWMAP_TYPE_VSM )
			shadow = VSMShadow( shadowMap, shadowCoord.xy, shadowCoord.z );
		#else
			shadow = texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z );
		#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	vec2 cubeToUV( vec3 v, float texelSizeY ) {
		vec3 absV = abs( v );
		float scaleToCube = 1.0 / max( absV.x, max( absV.y, absV.z ) );
		absV *= scaleToCube;
		v *= scaleToCube * ( 1.0 - 2.0 * texelSizeY );
		vec2 planar = v.xy;
		float almostATexel = 1.5 * texelSizeY;
		float almostOne = 1.0 - almostATexel;
		if ( absV.z >= almostOne ) {
			if ( v.z > 0.0 )
				planar.x = 4.0 - v.x;
		} else if ( absV.x >= almostOne ) {
			float signX = sign( v.x );
			planar.x = v.z * signX + 2.0 * signX;
		} else if ( absV.y >= almostOne ) {
			float signY = sign( v.y );
			planar.x = v.x + 2.0 * signY + 2.0;
			planar.y = v.z * signY - 2.0;
		}
		return vec2( 0.125, 0.25 ) * planar + vec2( 0.375, 0.75 );
	}
	float getPointShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		
		float lightToPositionLength = length( lightToPosition );
		if ( lightToPositionLength - shadowCameraFar <= 0.0 && lightToPositionLength - shadowCameraNear >= 0.0 ) {
			float dp = ( lightToPositionLength - shadowCameraNear ) / ( shadowCameraFar - shadowCameraNear );			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			vec2 texelSize = vec2( 1.0 ) / ( shadowMapSize * vec2( 4.0, 2.0 ) );
			#if defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_PCF_SOFT ) || defined( SHADOWMAP_TYPE_VSM )
				vec2 offset = vec2( - 1, 1 ) * shadowRadius * texelSize.y;
				shadow = (
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxx, texelSize.y ), dp )
				) * ( 1.0 / 9.0 );
			#else
				shadow = texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp );
			#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
#endif`,NT=`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,UT=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	vec3 shadowWorldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,OT=`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,FT=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,VT=`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,BT=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,kT=`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,zT=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,HT=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,GT=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,WT=`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 CineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,XT=`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = inverseTransformDirection( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseColor, material.specularColor, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,qT=`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec4 transmittedLight;
		vec3 transmittance;
		#ifdef USE_DISPERSION
			float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;
			vec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );
			for ( int i = 0; i < 3; i ++ ) {
				vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );
				vec3 refractedRayExit = position + transmissionRay;
		
				vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
				vec2 refractionCoords = ndcPos.xy / ndcPos.w;
				refractionCoords += 1.0;
				refractionCoords /= 2.0;
		
				vec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );
				transmittedLight[ i ] = transmissionSample[ i ];
				transmittedLight.a += transmissionSample.a;
				transmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];
			}
			transmittedLight.a /= 3.0;
		
		#else
		
			vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
			vec3 refractedRayExit = position + transmissionRay;
			vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
			vec2 refractionCoords = ndcPos.xy / ndcPos.w;
			refractionCoords += 1.0;
			refractionCoords /= 2.0;
			transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
			transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		
		#endif
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,jT=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,KT=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,$T=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,YT=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`;const JT=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,ZT=`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,QT=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,tS=`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float flipEnvMap;
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, backgroundRotation * vec3( flipEnvMap * vWorldDirection.x, vWorldDirection.yz ) );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,eS=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,nS=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,iS=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,sS=`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,rS=`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,oS=`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main () {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = packDepthToRGBA( dist );
}`,aS=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,cS=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,lS=`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,uS=`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,hS=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,dS=`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,fS=`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,pS=`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,mS=`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,gS=`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,_S=`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,vS=`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <packing>
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( packNormalToRGB( normal ), diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,yS=`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,xS=`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,ES=`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,TS=`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
		float sheenEnergyComp = 1.0 - 0.157 * max3( material.sheenColor );
		outgoingLight = outgoingLight * sheenEnergyComp + sheenSpecularDirect + sheenSpecularIndirect;
	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,SS=`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,AS=`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,MS=`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,wS=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,bS=`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,RS=`uniform vec3 color;
uniform float opacity;
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,IS=`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix[ 3 ];
	vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,CS=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,Yt={alphahash_fragment:Zx,alphahash_pars_fragment:Qx,alphamap_fragment:tE,alphamap_pars_fragment:eE,alphatest_fragment:nE,alphatest_pars_fragment:iE,aomap_fragment:sE,aomap_pars_fragment:rE,batching_pars_vertex:oE,batching_vertex:aE,begin_vertex:cE,beginnormal_vertex:lE,bsdfs:uE,iridescence_fragment:hE,bumpmap_pars_fragment:dE,clipping_planes_fragment:fE,clipping_planes_pars_fragment:pE,clipping_planes_pars_vertex:mE,clipping_planes_vertex:gE,color_fragment:_E,color_pars_fragment:vE,color_pars_vertex:yE,color_vertex:xE,common:EE,cube_uv_reflection_fragment:TE,defaultnormal_vertex:SE,displacementmap_pars_vertex:AE,displacementmap_vertex:ME,emissivemap_fragment:wE,emissivemap_pars_fragment:bE,colorspace_fragment:RE,colorspace_pars_fragment:IE,envmap_fragment:CE,envmap_common_pars_fragment:PE,envmap_pars_fragment:DE,envmap_pars_vertex:LE,envmap_physical_pars_fragment:WE,envmap_vertex:NE,fog_vertex:UE,fog_pars_vertex:OE,fog_fragment:FE,fog_pars_fragment:VE,gradientmap_pars_fragment:BE,lightmap_pars_fragment:kE,lights_lambert_fragment:zE,lights_lambert_pars_fragment:HE,lights_pars_begin:GE,lights_toon_fragment:XE,lights_toon_pars_fragment:qE,lights_phong_fragment:jE,lights_phong_pars_fragment:KE,lights_physical_fragment:$E,lights_physical_pars_fragment:YE,lights_fragment_begin:JE,lights_fragment_maps:ZE,lights_fragment_end:QE,logdepthbuf_fragment:tT,logdepthbuf_pars_fragment:eT,logdepthbuf_pars_vertex:nT,logdepthbuf_vertex:iT,map_fragment:sT,map_pars_fragment:rT,map_particle_fragment:oT,map_particle_pars_fragment:aT,metalnessmap_fragment:cT,metalnessmap_pars_fragment:lT,morphinstance_vertex:uT,morphcolor_vertex:hT,morphnormal_vertex:dT,morphtarget_pars_vertex:fT,morphtarget_vertex:pT,normal_fragment_begin:mT,normal_fragment_maps:gT,normal_pars_fragment:_T,normal_pars_vertex:vT,normal_vertex:yT,normalmap_pars_fragment:xT,clearcoat_normal_fragment_begin:ET,clearcoat_normal_fragment_maps:TT,clearcoat_pars_fragment:ST,iridescence_pars_fragment:AT,opaque_fragment:MT,packing:wT,premultiplied_alpha_fragment:bT,project_vertex:RT,dithering_fragment:IT,dithering_pars_fragment:CT,roughnessmap_fragment:PT,roughnessmap_pars_fragment:DT,shadowmap_pars_fragment:LT,shadowmap_pars_vertex:NT,shadowmap_vertex:UT,shadowmask_pars_fragment:OT,skinbase_vertex:FT,skinning_pars_vertex:VT,skinning_vertex:BT,skinnormal_vertex:kT,specularmap_fragment:zT,specularmap_pars_fragment:HT,tonemapping_fragment:GT,tonemapping_pars_fragment:WT,transmission_fragment:XT,transmission_pars_fragment:qT,uv_pars_fragment:jT,uv_pars_vertex:KT,uv_vertex:$T,worldpos_vertex:YT,background_vert:JT,background_frag:ZT,backgroundCube_vert:QT,backgroundCube_frag:tS,cube_vert:eS,cube_frag:nS,depth_vert:iS,depth_frag:sS,distanceRGBA_vert:rS,distanceRGBA_frag:oS,equirect_vert:aS,equirect_frag:cS,linedashed_vert:lS,linedashed_frag:uS,meshbasic_vert:hS,meshbasic_frag:dS,meshlambert_vert:fS,meshlambert_frag:pS,meshmatcap_vert:mS,meshmatcap_frag:gS,meshnormal_vert:_S,meshnormal_frag:vS,meshphong_vert:yS,meshphong_frag:xS,meshphysical_vert:ES,meshphysical_frag:TS,meshtoon_vert:SS,meshtoon_frag:AS,points_vert:MS,points_frag:wS,shadow_vert:bS,shadow_frag:RS,sprite_vert:IS,sprite_frag:CS},ht={common:{diffuse:{value:new It(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new Jt},alphaMap:{value:null},alphaMapTransform:{value:new Jt},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new Jt}},envmap:{envMap:{value:null},envMapRotation:{value:new Jt},flipEnvMap:{value:-1},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new Jt}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new Jt}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new Jt},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new Jt},normalScale:{value:new dt(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new Jt},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new Jt}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new Jt}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new Jt}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new It(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMap:{value:[]},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotShadowMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMap:{value:[]},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null}},points:{diffuse:{value:new It(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new Jt},alphaTest:{value:0},uvTransform:{value:new Jt}},sprite:{diffuse:{value:new It(16777215)},opacity:{value:1},center:{value:new dt(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new Jt},alphaMap:{value:null},alphaMapTransform:{value:new Jt},alphaTest:{value:0}}},fi={basic:{uniforms:bn([ht.common,ht.specularmap,ht.envmap,ht.aomap,ht.lightmap,ht.fog]),vertexShader:Yt.meshbasic_vert,fragmentShader:Yt.meshbasic_frag},lambert:{uniforms:bn([ht.common,ht.specularmap,ht.envmap,ht.aomap,ht.lightmap,ht.emissivemap,ht.bumpmap,ht.normalmap,ht.displacementmap,ht.fog,ht.lights,{emissive:{value:new It(0)}}]),vertexShader:Yt.meshlambert_vert,fragmentShader:Yt.meshlambert_frag},phong:{uniforms:bn([ht.common,ht.specularmap,ht.envmap,ht.aomap,ht.lightmap,ht.emissivemap,ht.bumpmap,ht.normalmap,ht.displacementmap,ht.fog,ht.lights,{emissive:{value:new It(0)},specular:{value:new It(1118481)},shininess:{value:30}}]),vertexShader:Yt.meshphong_vert,fragmentShader:Yt.meshphong_frag},standard:{uniforms:bn([ht.common,ht.envmap,ht.aomap,ht.lightmap,ht.emissivemap,ht.bumpmap,ht.normalmap,ht.displacementmap,ht.roughnessmap,ht.metalnessmap,ht.fog,ht.lights,{emissive:{value:new It(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:Yt.meshphysical_vert,fragmentShader:Yt.meshphysical_frag},toon:{uniforms:bn([ht.common,ht.aomap,ht.lightmap,ht.emissivemap,ht.bumpmap,ht.normalmap,ht.displacementmap,ht.gradientmap,ht.fog,ht.lights,{emissive:{value:new It(0)}}]),vertexShader:Yt.meshtoon_vert,fragmentShader:Yt.meshtoon_frag},matcap:{uniforms:bn([ht.common,ht.bumpmap,ht.normalmap,ht.displacementmap,ht.fog,{matcap:{value:null}}]),vertexShader:Yt.meshmatcap_vert,fragmentShader:Yt.meshmatcap_frag},points:{uniforms:bn([ht.points,ht.fog]),vertexShader:Yt.points_vert,fragmentShader:Yt.points_frag},dashed:{uniforms:bn([ht.common,ht.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:Yt.linedashed_vert,fragmentShader:Yt.linedashed_frag},depth:{uniforms:bn([ht.common,ht.displacementmap]),vertexShader:Yt.depth_vert,fragmentShader:Yt.depth_frag},normal:{uniforms:bn([ht.common,ht.bumpmap,ht.normalmap,ht.displacementmap,{opacity:{value:1}}]),vertexShader:Yt.meshnormal_vert,fragmentShader:Yt.meshnormal_frag},sprite:{uniforms:bn([ht.sprite,ht.fog]),vertexShader:Yt.sprite_vert,fragmentShader:Yt.sprite_frag},background:{uniforms:{uvTransform:{value:new Jt},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:Yt.background_vert,fragmentShader:Yt.background_frag},backgroundCube:{uniforms:{envMap:{value:null},flipEnvMap:{value:-1},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new Jt}},vertexShader:Yt.backgroundCube_vert,fragmentShader:Yt.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:Yt.cube_vert,fragmentShader:Yt.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:Yt.equirect_vert,fragmentShader:Yt.equirect_frag},distanceRGBA:{uniforms:bn([ht.common,ht.displacementmap,{referencePosition:{value:new O},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:Yt.distanceRGBA_vert,fragmentShader:Yt.distanceRGBA_frag},shadow:{uniforms:bn([ht.lights,ht.fog,{color:{value:new It(0)},opacity:{value:1}}]),vertexShader:Yt.shadow_vert,fragmentShader:Yt.shadow_frag}};fi.physical={uniforms:bn([fi.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new Jt},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new Jt},clearcoatNormalScale:{value:new dt(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new Jt},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new Jt},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new Jt},sheen:{value:0},sheenColor:{value:new It(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new Jt},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new Jt},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new Jt},transmissionSamplerSize:{value:new dt},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new Jt},attenuationDistance:{value:0},attenuationColor:{value:new It(0)},specularColor:{value:new It(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new Jt},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new Jt},anisotropyVector:{value:new dt},anisotropyMap:{value:null},anisotropyMapTransform:{value:new Jt}}]),vertexShader:Yt.meshphysical_vert,fragmentShader:Yt.meshphysical_frag};const fc={r:0,b:0,g:0},Ds=new ai,PS=new Gt;function DS(i,t,e,n,s,r,o){const a=new It(0);let c=r===!0?0:1,l,h,d=null,f=0,p=null;function v(A){let S=A.isScene===!0?A.background:null;return S&&S.isTexture&&(S=(A.backgroundBlurriness>0?e:t).get(S)),S}function x(A){let S=!1;const b=v(A);b===null?_(a,c):b&&b.isColor&&(_(b,1),S=!0);const F=i.xr.getEnvironmentBlendMode();F==="additive"?n.buffers.color.setClear(0,0,0,1,o):F==="alpha-blend"&&n.buffers.color.setClear(0,0,0,0,o),(i.autoClear||S)&&(n.buffers.depth.setTest(!0),n.buffers.depth.setMask(!0),n.buffers.color.setMask(!0),i.clear(i.autoClearColor,i.autoClearDepth,i.autoClearStencil))}function m(A,S){const b=v(S);b&&(b.isCubeTexture||b.mapping===Al)?(h===void 0&&(h=new ve(new We(1,1,1),new ms({name:"BackgroundCubeMaterial",uniforms:Zr(fi.backgroundCube.uniforms),vertexShader:fi.backgroundCube.vertexShader,fragmentShader:fi.backgroundCube.fragmentShader,side:Dn,depthTest:!1,depthWrite:!1,fog:!1})),h.geometry.deleteAttribute("normal"),h.geometry.deleteAttribute("uv"),h.onBeforeRender=function(F,N,M){this.matrixWorld.copyPosition(M.matrixWorld)},Object.defineProperty(h.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),s.update(h)),Ds.copy(S.backgroundRotation),Ds.x*=-1,Ds.y*=-1,Ds.z*=-1,b.isCubeTexture&&b.isRenderTargetTexture===!1&&(Ds.y*=-1,Ds.z*=-1),h.material.uniforms.envMap.value=b,h.material.uniforms.flipEnvMap.value=b.isCubeTexture&&b.isRenderTargetTexture===!1?-1:1,h.material.uniforms.backgroundBlurriness.value=S.backgroundBlurriness,h.material.uniforms.backgroundIntensity.value=S.backgroundIntensity,h.material.uniforms.backgroundRotation.value.setFromMatrix4(PS.makeRotationFromEuler(Ds)),h.material.toneMapped=me.getTransfer(b.colorSpace)!==Ie,(d!==b||f!==b.version||p!==i.toneMapping)&&(h.material.needsUpdate=!0,d=b,f=b.version,p=i.toneMapping),h.layers.enableAll(),A.unshift(h,h.geometry,h.material,0,0,null)):b&&b.isTexture&&(l===void 0&&(l=new ve(new us(2,2),new ms({name:"BackgroundMaterial",uniforms:Zr(fi.background.uniforms),vertexShader:fi.background.vertexShader,fragmentShader:fi.background.fragmentShader,side:yi,depthTest:!1,depthWrite:!1,fog:!1})),l.geometry.deleteAttribute("normal"),Object.defineProperty(l.material,"map",{get:function(){return this.uniforms.t2D.value}}),s.update(l)),l.material.uniforms.t2D.value=b,l.material.uniforms.backgroundIntensity.value=S.backgroundIntensity,l.material.toneMapped=me.getTransfer(b.colorSpace)!==Ie,b.matrixAutoUpdate===!0&&b.updateMatrix(),l.material.uniforms.uvTransform.value.copy(b.matrix),(d!==b||f!==b.version||p!==i.toneMapping)&&(l.material.needsUpdate=!0,d=b,f=b.version,p=i.toneMapping),l.layers.enableAll(),A.unshift(l,l.geometry,l.material,0,0,null))}function _(A,S){A.getRGB(fc,m_(i)),n.buffers.color.setClear(fc.r,fc.g,fc.b,S,o)}return{getClearColor:function(){return a},setClearColor:function(A,S=1){a.set(A),c=S,_(a,c)},getClearAlpha:function(){return c},setClearAlpha:function(A){c=A,_(a,c)},render:x,addToRenderList:m}}function LS(i,t){const e=i.getParameter(i.MAX_VERTEX_ATTRIBS),n={},s=f(null);let r=s,o=!1;function a(y,E,L,R,q){let nt=!1;const j=d(R,L,E);r!==j&&(r=j,l(r.object)),nt=p(y,R,L,q),nt&&v(y,R,L,q),q!==null&&t.update(q,i.ELEMENT_ARRAY_BUFFER),(nt||o)&&(o=!1,b(y,E,L,R),q!==null&&i.bindBuffer(i.ELEMENT_ARRAY_BUFFER,t.get(q).buffer))}function c(){return i.createVertexArray()}function l(y){return i.bindVertexArray(y)}function h(y){return i.deleteVertexArray(y)}function d(y,E,L){const R=L.wireframe===!0;let q=n[y.id];q===void 0&&(q={},n[y.id]=q);let nt=q[E.id];nt===void 0&&(nt={},q[E.id]=nt);let j=nt[R];return j===void 0&&(j=f(c()),nt[R]=j),j}function f(y){const E=[],L=[],R=[];for(let q=0;q<e;q++)E[q]=0,L[q]=0,R[q]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:E,enabledAttributes:L,attributeDivisors:R,object:y,attributes:{},index:null}}function p(y,E,L,R){const q=r.attributes,nt=E.attributes;let j=0;const ot=L.getAttributes();for(const Y in ot)if(ot[Y].location>=0){const Tt=q[Y];let Ct=nt[Y];if(Ct===void 0&&(Y==="instanceMatrix"&&y.instanceMatrix&&(Ct=y.instanceMatrix),Y==="instanceColor"&&y.instanceColor&&(Ct=y.instanceColor)),Tt===void 0||Tt.attribute!==Ct||Ct&&Tt.data!==Ct.data)return!0;j++}return r.attributesNum!==j||r.index!==R}function v(y,E,L,R){const q={},nt=E.attributes;let j=0;const ot=L.getAttributes();for(const Y in ot)if(ot[Y].location>=0){let Tt=nt[Y];Tt===void 0&&(Y==="instanceMatrix"&&y.instanceMatrix&&(Tt=y.instanceMatrix),Y==="instanceColor"&&y.instanceColor&&(Tt=y.instanceColor));const Ct={};Ct.attribute=Tt,Tt&&Tt.data&&(Ct.data=Tt.data),q[Y]=Ct,j++}r.attributes=q,r.attributesNum=j,r.index=R}function x(){const y=r.newAttributes;for(let E=0,L=y.length;E<L;E++)y[E]=0}function m(y){_(y,0)}function _(y,E){const L=r.newAttributes,R=r.enabledAttributes,q=r.attributeDivisors;L[y]=1,R[y]===0&&(i.enableVertexAttribArray(y),R[y]=1),q[y]!==E&&(i.vertexAttribDivisor(y,E),q[y]=E)}function A(){const y=r.newAttributes,E=r.enabledAttributes;for(let L=0,R=E.length;L<R;L++)E[L]!==y[L]&&(i.disableVertexAttribArray(L),E[L]=0)}function S(y,E,L,R,q,nt,j){j===!0?i.vertexAttribIPointer(y,E,L,q,nt):i.vertexAttribPointer(y,E,L,R,q,nt)}function b(y,E,L,R){x();const q=R.attributes,nt=L.getAttributes(),j=E.defaultAttributeValues;for(const ot in nt){const Y=nt[ot];if(Y.location>=0){let Et=q[ot];if(Et===void 0&&(ot==="instanceMatrix"&&y.instanceMatrix&&(Et=y.instanceMatrix),ot==="instanceColor"&&y.instanceColor&&(Et=y.instanceColor)),Et!==void 0){const Tt=Et.normalized,Ct=Et.itemSize,$t=t.get(Et);if($t===void 0)continue;const Ht=$t.buffer,J=$t.type,rt=$t.bytesPerElement,bt=J===i.INT||J===i.UNSIGNED_INT||Et.gpuType===gd;if(Et.isInterleavedBufferAttribute){const vt=Et.data,Xt=vt.stride,Vt=Et.offset;if(vt.isInstancedInterleavedBuffer){for(let Qt=0;Qt<Y.locationSize;Qt++)_(Y.location+Qt,vt.meshPerAttribute);y.isInstancedMesh!==!0&&R._maxInstanceCount===void 0&&(R._maxInstanceCount=vt.meshPerAttribute*vt.count)}else for(let Qt=0;Qt<Y.locationSize;Qt++)m(Y.location+Qt);i.bindBuffer(i.ARRAY_BUFFER,Ht);for(let Qt=0;Qt<Y.locationSize;Qt++)S(Y.location+Qt,Ct/Y.locationSize,J,Tt,Xt*rt,(Vt+Ct/Y.locationSize*Qt)*rt,bt)}else{if(Et.isInstancedBufferAttribute){for(let vt=0;vt<Y.locationSize;vt++)_(Y.location+vt,Et.meshPerAttribute);y.isInstancedMesh!==!0&&R._maxInstanceCount===void 0&&(R._maxInstanceCount=Et.meshPerAttribute*Et.count)}else for(let vt=0;vt<Y.locationSize;vt++)m(Y.location+vt);i.bindBuffer(i.ARRAY_BUFFER,Ht);for(let vt=0;vt<Y.locationSize;vt++)S(Y.location+vt,Ct/Y.locationSize,J,Tt,Ct*rt,Ct/Y.locationSize*vt*rt,bt)}}else if(j!==void 0){const Tt=j[ot];if(Tt!==void 0)switch(Tt.length){case 2:i.vertexAttrib2fv(Y.location,Tt);break;case 3:i.vertexAttrib3fv(Y.location,Tt);break;case 4:i.vertexAttrib4fv(Y.location,Tt);break;default:i.vertexAttrib1fv(Y.location,Tt)}}}}A()}function F(){w();for(const y in n){const E=n[y];for(const L in E){const R=E[L];for(const q in R)h(R[q].object),delete R[q];delete E[L]}delete n[y]}}function N(y){if(n[y.id]===void 0)return;const E=n[y.id];for(const L in E){const R=E[L];for(const q in R)h(R[q].object),delete R[q];delete E[L]}delete n[y.id]}function M(y){for(const E in n){const L=n[E];if(L[y.id]===void 0)continue;const R=L[y.id];for(const q in R)h(R[q].object),delete R[q];delete L[y.id]}}function w(){C(),o=!0,r!==s&&(r=s,l(r.object))}function C(){s.geometry=null,s.program=null,s.wireframe=!1}return{setup:a,reset:w,resetDefaultState:C,dispose:F,releaseStatesOfGeometry:N,releaseStatesOfProgram:M,initAttributes:x,enableAttribute:m,disableUnusedAttributes:A}}function NS(i,t,e){let n;function s(l){n=l}function r(l,h){i.drawArrays(n,l,h),e.update(h,n,1)}function o(l,h,d){d!==0&&(i.drawArraysInstanced(n,l,h,d),e.update(h,n,d))}function a(l,h,d){if(d===0)return;t.get("WEBGL_multi_draw").multiDrawArraysWEBGL(n,l,0,h,0,d);let p=0;for(let v=0;v<d;v++)p+=h[v];e.update(p,n,1)}function c(l,h,d,f){if(d===0)return;const p=t.get("WEBGL_multi_draw");if(p===null)for(let v=0;v<l.length;v++)o(l[v],h[v],f[v]);else{p.multiDrawArraysInstancedWEBGL(n,l,0,h,0,f,0,d);let v=0;for(let x=0;x<d;x++)v+=h[x];for(let x=0;x<f.length;x++)e.update(v,n,f[x])}}this.setMode=s,this.render=r,this.renderInstances=o,this.renderMultiDraw=a,this.renderMultiDrawInstances=c}function US(i,t,e,n){let s;function r(){if(s!==void 0)return s;if(t.has("EXT_texture_filter_anisotropic")===!0){const M=t.get("EXT_texture_filter_anisotropic");s=i.getParameter(M.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else s=0;return s}function o(M){return!(M!==Xn&&n.convert(M)!==i.getParameter(i.IMPLEMENTATION_COLOR_READ_FORMAT))}function a(M){const w=M===Ia&&(t.has("EXT_color_buffer_half_float")||t.has("EXT_color_buffer_float"));return!(M!==ki&&n.convert(M)!==i.getParameter(i.IMPLEMENTATION_COLOR_READ_TYPE)&&M!==si&&!w)}function c(M){if(M==="highp"){if(i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.HIGH_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.HIGH_FLOAT).precision>0)return"highp";M="mediump"}return M==="mediump"&&i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.MEDIUM_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let l=e.precision!==void 0?e.precision:"highp";const h=c(l);h!==l&&(console.warn("THREE.WebGLRenderer:",l,"not supported, using",h,"instead."),l=h);const d=e.logarithmicDepthBuffer===!0,f=e.reverseDepthBuffer===!0&&t.has("EXT_clip_control");if(f===!0){const M=t.get("EXT_clip_control");M.clipControlEXT(M.LOWER_LEFT_EXT,M.ZERO_TO_ONE_EXT)}const p=i.getParameter(i.MAX_TEXTURE_IMAGE_UNITS),v=i.getParameter(i.MAX_VERTEX_TEXTURE_IMAGE_UNITS),x=i.getParameter(i.MAX_TEXTURE_SIZE),m=i.getParameter(i.MAX_CUBE_MAP_TEXTURE_SIZE),_=i.getParameter(i.MAX_VERTEX_ATTRIBS),A=i.getParameter(i.MAX_VERTEX_UNIFORM_VECTORS),S=i.getParameter(i.MAX_VARYING_VECTORS),b=i.getParameter(i.MAX_FRAGMENT_UNIFORM_VECTORS),F=v>0,N=i.getParameter(i.MAX_SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:r,getMaxPrecision:c,textureFormatReadable:o,textureTypeReadable:a,precision:l,logarithmicDepthBuffer:d,reverseDepthBuffer:f,maxTextures:p,maxVertexTextures:v,maxTextureSize:x,maxCubemapSize:m,maxAttributes:_,maxVertexUniforms:A,maxVaryings:S,maxFragmentUniforms:b,vertexTextures:F,maxSamples:N}}function OS(i){const t=this;let e=null,n=0,s=!1,r=!1;const o=new Us,a=new Jt,c={value:null,needsUpdate:!1};this.uniform=c,this.numPlanes=0,this.numIntersection=0,this.init=function(d,f){const p=d.length!==0||f||n!==0||s;return s=f,n=d.length,p},this.beginShadows=function(){r=!0,h(null)},this.endShadows=function(){r=!1},this.setGlobalState=function(d,f){e=h(d,f,0)},this.setState=function(d,f,p){const v=d.clippingPlanes,x=d.clipIntersection,m=d.clipShadows,_=i.get(d);if(!s||v===null||v.length===0||r&&!m)r?h(null):l();else{const A=r?0:n,S=A*4;let b=_.clippingState||null;c.value=b,b=h(v,f,S,p);for(let F=0;F!==S;++F)b[F]=e[F];_.clippingState=b,this.numIntersection=x?this.numPlanes:0,this.numPlanes+=A}};function l(){c.value!==e&&(c.value=e,c.needsUpdate=n>0),t.numPlanes=n,t.numIntersection=0}function h(d,f,p,v){const x=d!==null?d.length:0;let m=null;if(x!==0){if(m=c.value,v!==!0||m===null){const _=p+x*4,A=f.matrixWorldInverse;a.getNormalMatrix(A),(m===null||m.length<_)&&(m=new Float32Array(_));for(let S=0,b=p;S!==x;++S,b+=4)o.copy(d[S]).applyMatrix4(A,a),o.normal.toArray(m,b),m[b+3]=o.constant}c.value=m,c.needsUpdate=!0}return t.numPlanes=x,t.numIntersection=0,m}}function FS(i){let t=new WeakMap;function e(o,a){return a===oh?o.mapping=jr:a===ah&&(o.mapping=Kr),o}function n(o){if(o&&o.isTexture){const a=o.mapping;if(a===oh||a===ah)if(t.has(o)){const c=t.get(o).texture;return e(c,o.mapping)}else{const c=o.image;if(c&&c.height>0){const l=new Kx(c.height);return l.fromEquirectangularTexture(i,o),t.set(o,l),o.addEventListener("dispose",s),e(l.texture,o.mapping)}else return null}}return o}function s(o){const a=o.target;a.removeEventListener("dispose",s);const c=t.get(a);c!==void 0&&(t.delete(a),c.dispose())}function r(){t=new WeakMap}return{get:n,dispose:r}}class Id extends g_{constructor(t=-1,e=1,n=1,s=-1,r=.1,o=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=t,this.right=e,this.top=n,this.bottom=s,this.near=r,this.far=o,this.updateProjectionMatrix()}copy(t,e){return super.copy(t,e),this.left=t.left,this.right=t.right,this.top=t.top,this.bottom=t.bottom,this.near=t.near,this.far=t.far,this.zoom=t.zoom,this.view=t.view===null?null:Object.assign({},t.view),this}setViewOffset(t,e,n,s,r,o){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=t,this.view.fullHeight=e,this.view.offsetX=n,this.view.offsetY=s,this.view.width=r,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const t=(this.right-this.left)/(2*this.zoom),e=(this.top-this.bottom)/(2*this.zoom),n=(this.right+this.left)/2,s=(this.top+this.bottom)/2;let r=n-t,o=n+t,a=s+e,c=s-e;if(this.view!==null&&this.view.enabled){const l=(this.right-this.left)/this.view.fullWidth/this.zoom,h=(this.top-this.bottom)/this.view.fullHeight/this.zoom;r+=l*this.view.offsetX,o=r+l*this.view.width,a-=h*this.view.offsetY,c=a-h*this.view.height}this.projectionMatrix.makeOrthographic(r,o,a,c,this.near,this.far,this.coordinateSystem),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(t){const e=super.toJSON(t);return e.object.zoom=this.zoom,e.object.left=this.left,e.object.right=this.right,e.object.top=this.top,e.object.bottom=this.bottom,e.object.near=this.near,e.object.far=this.far,this.view!==null&&(e.object.view=Object.assign({},this.view)),e}}const Fr=4,Sp=[.125,.215,.35,.446,.526,.582],Bs=20,vu=new Id,Ap=new It;let yu=null,xu=0,Eu=0,Tu=!1;const Os=(1+Math.sqrt(5))/2,Ar=1/Os,Mp=[new O(-Os,Ar,0),new O(Os,Ar,0),new O(-Ar,0,Os),new O(Ar,0,Os),new O(0,Os,-Ar),new O(0,Os,Ar),new O(-1,1,-1),new O(1,1,-1),new O(-1,1,1),new O(1,1,1)];class wp{constructor(t){this._renderer=t,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._lodPlanes=[],this._sizeLods=[],this._sigmas=[],this._blurMaterial=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._compileMaterial(this._blurMaterial)}fromScene(t,e=0,n=.1,s=100){yu=this._renderer.getRenderTarget(),xu=this._renderer.getActiveCubeFace(),Eu=this._renderer.getActiveMipmapLevel(),Tu=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(256);const r=this._allocateTargets();return r.depthBuffer=!0,this._sceneToCubeUV(t,n,s,r),e>0&&this._blur(r,0,0,e),this._applyPMREM(r),this._cleanup(r),r}fromEquirectangular(t,e=null){return this._fromTexture(t,e)}fromCubemap(t,e=null){return this._fromTexture(t,e)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=Ip(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=Rp(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose()}_setSize(t){this._lodMax=Math.floor(Math.log2(t)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let t=0;t<this._lodPlanes.length;t++)this._lodPlanes[t].dispose()}_cleanup(t){this._renderer.setRenderTarget(yu,xu,Eu),this._renderer.xr.enabled=Tu,t.scissorTest=!1,pc(t,0,0,t.width,t.height)}_fromTexture(t,e){t.mapping===jr||t.mapping===Kr?this._setSize(t.image.length===0?16:t.image[0].width||t.image[0].image.width):this._setSize(t.image.width/4),yu=this._renderer.getRenderTarget(),xu=this._renderer.getActiveCubeFace(),Eu=this._renderer.getActiveMipmapLevel(),Tu=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;const n=e||this._allocateTargets();return this._textureToCubeUV(t,n),this._applyPMREM(n),this._cleanup(n),n}_allocateTargets(){const t=3*Math.max(this._cubeSize,112),e=4*this._cubeSize,n={magFilter:Fn,minFilter:Fn,generateMipmaps:!1,type:Ia,format:Xn,colorSpace:fn,depthBuffer:!1},s=bp(t,e,n);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==t||this._pingPongRenderTarget.height!==e){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=bp(t,e,n);const{_lodMax:r}=this;({sizeLods:this._sizeLods,lodPlanes:this._lodPlanes,sigmas:this._sigmas}=VS(r)),this._blurMaterial=BS(r,t,e)}return s}_compileMaterial(t){const e=new ve(this._lodPlanes[0],t);this._renderer.compile(e,vu)}_sceneToCubeUV(t,e,n,s){const a=new Pn(90,1,e,n),c=[1,-1,1,1,1,1],l=[1,1,1,-1,-1,-1],h=this._renderer,d=h.autoClear,f=h.toneMapping;h.getClearColor(Ap),h.toneMapping=ls,h.autoClear=!1;const p=new ks({name:"PMREM.Background",side:Dn,depthWrite:!1,depthTest:!1}),v=new ve(new We,p);let x=!1;const m=t.background;m?m.isColor&&(p.color.copy(m),t.background=null,x=!0):(p.color.copy(Ap),x=!0);for(let _=0;_<6;_++){const A=_%3;A===0?(a.up.set(0,c[_],0),a.lookAt(l[_],0,0)):A===1?(a.up.set(0,0,c[_]),a.lookAt(0,l[_],0)):(a.up.set(0,c[_],0),a.lookAt(0,0,l[_]));const S=this._cubeSize;pc(s,A*S,_>2?S:0,S,S),h.setRenderTarget(s),x&&h.render(v,a),h.render(t,a)}v.geometry.dispose(),v.material.dispose(),h.toneMapping=f,h.autoClear=d,t.background=m}_textureToCubeUV(t,e){const n=this._renderer,s=t.mapping===jr||t.mapping===Kr;s?(this._cubemapMaterial===null&&(this._cubemapMaterial=Ip()),this._cubemapMaterial.uniforms.flipEnvMap.value=t.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=Rp());const r=s?this._cubemapMaterial:this._equirectMaterial,o=new ve(this._lodPlanes[0],r),a=r.uniforms;a.envMap.value=t;const c=this._cubeSize;pc(e,0,0,3*c,2*c),n.setRenderTarget(e),n.render(o,vu)}_applyPMREM(t){const e=this._renderer,n=e.autoClear;e.autoClear=!1;const s=this._lodPlanes.length;for(let r=1;r<s;r++){const o=Math.sqrt(this._sigmas[r]*this._sigmas[r]-this._sigmas[r-1]*this._sigmas[r-1]),a=Mp[(s-r-1)%Mp.length];this._blur(t,r-1,r,o,a)}e.autoClear=n}_blur(t,e,n,s,r){const o=this._pingPongRenderTarget;this._halfBlur(t,o,e,n,s,"latitudinal",r),this._halfBlur(o,t,n,n,s,"longitudinal",r)}_halfBlur(t,e,n,s,r,o,a){const c=this._renderer,l=this._blurMaterial;o!=="latitudinal"&&o!=="longitudinal"&&console.error("blur direction must be either latitudinal or longitudinal!");const h=3,d=new ve(this._lodPlanes[s],l),f=l.uniforms,p=this._sizeLods[n]-1,v=isFinite(r)?Math.PI/(2*p):2*Math.PI/(2*Bs-1),x=r/v,m=isFinite(r)?1+Math.floor(h*x):Bs;m>Bs&&console.warn(`sigmaRadians, ${r}, is too large and will clip, as it requested ${m} samples when the maximum is set to ${Bs}`);const _=[];let A=0;for(let M=0;M<Bs;++M){const w=M/x,C=Math.exp(-w*w/2);_.push(C),M===0?A+=C:M<m&&(A+=2*C)}for(let M=0;M<_.length;M++)_[M]=_[M]/A;f.envMap.value=t.texture,f.samples.value=m,f.weights.value=_,f.latitudinal.value=o==="latitudinal",a&&(f.poleAxis.value=a);const{_lodMax:S}=this;f.dTheta.value=v,f.mipInt.value=S-n;const b=this._sizeLods[s],F=3*b*(s>S-Fr?s-S+Fr:0),N=4*(this._cubeSize-b);pc(e,F,N,3*b,2*b),c.setRenderTarget(e),c.render(d,vu)}}function VS(i){const t=[],e=[],n=[];let s=i;const r=i-Fr+1+Sp.length;for(let o=0;o<r;o++){const a=Math.pow(2,s);e.push(a);let c=1/a;o>i-Fr?c=Sp[o-i+Fr-1]:o===0&&(c=0),n.push(c);const l=1/(a-2),h=-l,d=1+l,f=[h,h,d,h,d,d,h,h,d,d,h,d],p=6,v=6,x=3,m=2,_=1,A=new Float32Array(x*v*p),S=new Float32Array(m*v*p),b=new Float32Array(_*v*p);for(let N=0;N<p;N++){const M=N%3*2/3-1,w=N>2?0:-1,C=[M,w,0,M+2/3,w,0,M+2/3,w+1,0,M,w,0,M+2/3,w+1,0,M,w+1,0];A.set(C,x*v*N),S.set(f,m*v*N);const y=[N,N,N,N,N,N];b.set(y,_*v*N)}const F=new mn;F.setAttribute("position",new An(A,x)),F.setAttribute("uv",new An(S,m)),F.setAttribute("faceIndex",new An(b,_)),t.push(F),s>Fr&&s--}return{lodPlanes:t,sizeLods:e,sigmas:n}}function bp(i,t,e){const n=new Ys(i,t,e);return n.texture.mapping=Al,n.texture.name="PMREM.cubeUv",n.scissorTest=!0,n}function pc(i,t,e,n,s){i.viewport.set(t,e,n,s),i.scissor.set(t,e,n,s)}function BS(i,t,e){const n=new Float32Array(Bs),s=new O(0,1,0);return new ms({name:"SphericalGaussianBlur",defines:{n:Bs,CUBEUV_TEXEL_WIDTH:1/t,CUBEUV_TEXEL_HEIGHT:1/e,CUBEUV_MAX_MIP:`${i}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:n},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:s}},vertexShader:Cd(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform int samples;
			uniform float weights[ n ];
			uniform bool latitudinal;
			uniform float dTheta;
			uniform float mipInt;
			uniform vec3 poleAxis;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			vec3 getSample( float theta, vec3 axis ) {

				float cosTheta = cos( theta );
				// Rodrigues' axis-angle rotation
				vec3 sampleDirection = vOutputDirection * cosTheta
					+ cross( axis, vOutputDirection ) * sin( theta )
					+ axis * dot( axis, vOutputDirection ) * ( 1.0 - cosTheta );

				return bilinearCubeUV( envMap, sampleDirection, mipInt );

			}

			void main() {

				vec3 axis = latitudinal ? poleAxis : cross( poleAxis, vOutputDirection );

				if ( all( equal( axis, vec3( 0.0 ) ) ) ) {

					axis = vec3( vOutputDirection.z, 0.0, - vOutputDirection.x );

				}

				axis = normalize( axis );

				gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
				gl_FragColor.rgb += weights[ 0 ] * getSample( 0.0, axis );

				for ( int i = 1; i < n; i++ ) {

					if ( i >= samples ) {

						break;

					}

					float theta = dTheta * float( i );
					gl_FragColor.rgb += weights[ i ] * getSample( -1.0 * theta, axis );
					gl_FragColor.rgb += weights[ i ] * getSample( theta, axis );

				}

			}
		`,blending:cs,depthTest:!1,depthWrite:!1})}function Rp(){return new ms({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:Cd(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;

			#include <common>

			void main() {

				vec3 outputDirection = normalize( vOutputDirection );
				vec2 uv = equirectUv( outputDirection );

				gl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );

			}
		`,blending:cs,depthTest:!1,depthWrite:!1})}function Ip(){return new ms({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:Cd(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:cs,depthTest:!1,depthWrite:!1})}function Cd(){return`

		precision mediump float;
		precision mediump int;

		attribute float faceIndex;

		varying vec3 vOutputDirection;

		// RH coordinate system; PMREM face-indexing convention
		vec3 getDirection( vec2 uv, float face ) {

			uv = 2.0 * uv - 1.0;

			vec3 direction = vec3( uv, 1.0 );

			if ( face == 0.0 ) {

				direction = direction.zyx; // ( 1, v, u ) pos x

			} else if ( face == 1.0 ) {

				direction = direction.xzy;
				direction.xz *= -1.0; // ( -u, 1, -v ) pos y

			} else if ( face == 2.0 ) {

				direction.x *= -1.0; // ( -u, v, 1 ) pos z

			} else if ( face == 3.0 ) {

				direction = direction.zyx;
				direction.xz *= -1.0; // ( -1, v, -u ) neg x

			} else if ( face == 4.0 ) {

				direction = direction.xzy;
				direction.xy *= -1.0; // ( -u, -1, v ) neg y

			} else if ( face == 5.0 ) {

				direction.z *= -1.0; // ( u, v, -1 ) neg z

			}

			return direction;

		}

		void main() {

			vOutputDirection = getDirection( uv, faceIndex );
			gl_Position = vec4( position, 1.0 );

		}
	`}function kS(i){let t=new WeakMap,e=null;function n(a){if(a&&a.isTexture){const c=a.mapping,l=c===oh||c===ah,h=c===jr||c===Kr;if(l||h){let d=t.get(a);const f=d!==void 0?d.texture.pmremVersion:0;if(a.isRenderTargetTexture&&a.pmremVersion!==f)return e===null&&(e=new wp(i)),d=l?e.fromEquirectangular(a,d):e.fromCubemap(a,d),d.texture.pmremVersion=a.pmremVersion,t.set(a,d),d.texture;if(d!==void 0)return d.texture;{const p=a.image;return l&&p&&p.height>0||h&&p&&s(p)?(e===null&&(e=new wp(i)),d=l?e.fromEquirectangular(a):e.fromCubemap(a),d.texture.pmremVersion=a.pmremVersion,t.set(a,d),a.addEventListener("dispose",r),d.texture):null}}}return a}function s(a){let c=0;const l=6;for(let h=0;h<l;h++)a[h]!==void 0&&c++;return c===l}function r(a){const c=a.target;c.removeEventListener("dispose",r);const l=t.get(c);l!==void 0&&(t.delete(c),l.dispose())}function o(){t=new WeakMap,e!==null&&(e.dispose(),e=null)}return{get:n,dispose:o}}function zS(i){const t={};function e(n){if(t[n]!==void 0)return t[n];let s;switch(n){case"WEBGL_depth_texture":s=i.getExtension("WEBGL_depth_texture")||i.getExtension("MOZ_WEBGL_depth_texture")||i.getExtension("WEBKIT_WEBGL_depth_texture");break;case"EXT_texture_filter_anisotropic":s=i.getExtension("EXT_texture_filter_anisotropic")||i.getExtension("MOZ_EXT_texture_filter_anisotropic")||i.getExtension("WEBKIT_EXT_texture_filter_anisotropic");break;case"WEBGL_compressed_texture_s3tc":s=i.getExtension("WEBGL_compressed_texture_s3tc")||i.getExtension("MOZ_WEBGL_compressed_texture_s3tc")||i.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc");break;case"WEBGL_compressed_texture_pvrtc":s=i.getExtension("WEBGL_compressed_texture_pvrtc")||i.getExtension("WEBKIT_WEBGL_compressed_texture_pvrtc");break;default:s=i.getExtension(n)}return t[n]=s,s}return{has:function(n){return e(n)!==null},init:function(){e("EXT_color_buffer_float"),e("WEBGL_clip_cull_distance"),e("OES_texture_float_linear"),e("EXT_color_buffer_half_float"),e("WEBGL_multisampled_render_to_texture"),e("WEBGL_render_shared_exponent")},get:function(n){const s=e(n);return s===null&&kc("THREE.WebGLRenderer: "+n+" extension not supported."),s}}}function HS(i,t,e,n){const s={},r=new WeakMap;function o(d){const f=d.target;f.index!==null&&t.remove(f.index);for(const v in f.attributes)t.remove(f.attributes[v]);for(const v in f.morphAttributes){const x=f.morphAttributes[v];for(let m=0,_=x.length;m<_;m++)t.remove(x[m])}f.removeEventListener("dispose",o),delete s[f.id];const p=r.get(f);p&&(t.remove(p),r.delete(f)),n.releaseStatesOfGeometry(f),f.isInstancedBufferGeometry===!0&&delete f._maxInstanceCount,e.memory.geometries--}function a(d,f){return s[f.id]===!0||(f.addEventListener("dispose",o),s[f.id]=!0,e.memory.geometries++),f}function c(d){const f=d.attributes;for(const v in f)t.update(f[v],i.ARRAY_BUFFER);const p=d.morphAttributes;for(const v in p){const x=p[v];for(let m=0,_=x.length;m<_;m++)t.update(x[m],i.ARRAY_BUFFER)}}function l(d){const f=[],p=d.index,v=d.attributes.position;let x=0;if(p!==null){const A=p.array;x=p.version;for(let S=0,b=A.length;S<b;S+=3){const F=A[S+0],N=A[S+1],M=A[S+2];f.push(F,N,N,M,M,F)}}else if(v!==void 0){const A=v.array;x=v.version;for(let S=0,b=A.length/3-1;S<b;S+=3){const F=S+0,N=S+1,M=S+2;f.push(F,N,N,M,M,F)}}else return;const m=new(l_(f)?p_:f_)(f,1);m.version=x;const _=r.get(d);_&&t.remove(_),r.set(d,m)}function h(d){const f=r.get(d);if(f){const p=d.index;p!==null&&f.version<p.version&&l(d)}else l(d);return r.get(d)}return{get:a,update:c,getWireframeAttribute:h}}function GS(i,t,e){let n;function s(f){n=f}let r,o;function a(f){r=f.type,o=f.bytesPerElement}function c(f,p){i.drawElements(n,p,r,f*o),e.update(p,n,1)}function l(f,p,v){v!==0&&(i.drawElementsInstanced(n,p,r,f*o,v),e.update(p,n,v))}function h(f,p,v){if(v===0)return;t.get("WEBGL_multi_draw").multiDrawElementsWEBGL(n,p,0,r,f,0,v);let m=0;for(let _=0;_<v;_++)m+=p[_];e.update(m,n,1)}function d(f,p,v,x){if(v===0)return;const m=t.get("WEBGL_multi_draw");if(m===null)for(let _=0;_<f.length;_++)l(f[_]/o,p[_],x[_]);else{m.multiDrawElementsInstancedWEBGL(n,p,0,r,f,0,x,0,v);let _=0;for(let A=0;A<v;A++)_+=p[A];for(let A=0;A<x.length;A++)e.update(_,n,x[A])}}this.setMode=s,this.setIndex=a,this.render=c,this.renderInstances=l,this.renderMultiDraw=h,this.renderMultiDrawInstances=d}function WS(i){const t={geometries:0,textures:0},e={frame:0,calls:0,triangles:0,points:0,lines:0};function n(r,o,a){switch(e.calls++,o){case i.TRIANGLES:e.triangles+=a*(r/3);break;case i.LINES:e.lines+=a*(r/2);break;case i.LINE_STRIP:e.lines+=a*(r-1);break;case i.LINE_LOOP:e.lines+=a*r;break;case i.POINTS:e.points+=a*r;break;default:console.error("THREE.WebGLInfo: Unknown draw mode:",o);break}}function s(){e.calls=0,e.triangles=0,e.points=0,e.lines=0}return{memory:t,render:e,programs:null,autoReset:!0,reset:s,update:n}}function XS(i,t,e){const n=new WeakMap,s=new ge;function r(o,a,c){const l=o.morphTargetInfluences,h=a.morphAttributes.position||a.morphAttributes.normal||a.morphAttributes.color,d=h!==void 0?h.length:0;let f=n.get(a);if(f===void 0||f.count!==d){let C=function(){M.dispose(),n.delete(a),a.removeEventListener("dispose",C)};f!==void 0&&f.texture.dispose();const p=a.morphAttributes.position!==void 0,v=a.morphAttributes.normal!==void 0,x=a.morphAttributes.color!==void 0,m=a.morphAttributes.position||[],_=a.morphAttributes.normal||[],A=a.morphAttributes.color||[];let S=0;p===!0&&(S=1),v===!0&&(S=2),x===!0&&(S=3);let b=a.attributes.position.count*S,F=1;b>t.maxTextureSize&&(F=Math.ceil(b/t.maxTextureSize),b=t.maxTextureSize);const N=new Float32Array(b*F*4*d),M=new h_(N,b,F,d);M.type=si,M.needsUpdate=!0;const w=S*4;for(let y=0;y<d;y++){const E=m[y],L=_[y],R=A[y],q=b*F*4*y;for(let nt=0;nt<E.count;nt++){const j=nt*w;p===!0&&(s.fromBufferAttribute(E,nt),N[q+j+0]=s.x,N[q+j+1]=s.y,N[q+j+2]=s.z,N[q+j+3]=0),v===!0&&(s.fromBufferAttribute(L,nt),N[q+j+4]=s.x,N[q+j+5]=s.y,N[q+j+6]=s.z,N[q+j+7]=0),x===!0&&(s.fromBufferAttribute(R,nt),N[q+j+8]=s.x,N[q+j+9]=s.y,N[q+j+10]=s.z,N[q+j+11]=R.itemSize===4?s.w:1)}}f={count:d,texture:M,size:new dt(b,F)},n.set(a,f),a.addEventListener("dispose",C)}if(o.isInstancedMesh===!0&&o.morphTexture!==null)c.getUniforms().setValue(i,"morphTexture",o.morphTexture,e);else{let p=0;for(let x=0;x<l.length;x++)p+=l[x];const v=a.morphTargetsRelative?1:1-p;c.getUniforms().setValue(i,"morphTargetBaseInfluence",v),c.getUniforms().setValue(i,"morphTargetInfluences",l)}c.getUniforms().setValue(i,"morphTargetsTexture",f.texture,e),c.getUniforms().setValue(i,"morphTargetsTextureSize",f.size)}return{update:r}}function qS(i,t,e,n){let s=new WeakMap;function r(c){const l=n.render.frame,h=c.geometry,d=t.get(c,h);if(s.get(d)!==l&&(t.update(d),s.set(d,l)),c.isInstancedMesh&&(c.hasEventListener("dispose",a)===!1&&c.addEventListener("dispose",a),s.get(c)!==l&&(e.update(c.instanceMatrix,i.ARRAY_BUFFER),c.instanceColor!==null&&e.update(c.instanceColor,i.ARRAY_BUFFER),s.set(c,l))),c.isSkinnedMesh){const f=c.skeleton;s.get(f)!==l&&(f.update(),s.set(f,l))}return d}function o(){s=new WeakMap}function a(c){const l=c.target;l.removeEventListener("dispose",a),e.remove(l.instanceMatrix),l.instanceColor!==null&&e.remove(l.instanceColor)}return{update:r,dispose:o}}class y_ extends Ze{constructor(t,e,n,s,r,o,a,c,l,h=kr){if(h!==kr&&h!==Yr)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");n===void 0&&h===kr&&(n=$s),n===void 0&&h===Yr&&(n=$r),super(null,s,r,o,a,c,h,n,l),this.isDepthTexture=!0,this.image={width:t,height:e},this.magFilter=a!==void 0?a:Rn,this.minFilter=c!==void 0?c:Rn,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(t){return super.copy(t),this.compareFunction=t.compareFunction,this}toJSON(t){const e=super.toJSON(t);return this.compareFunction!==null&&(e.compareFunction=this.compareFunction),e}}const x_=new Ze,Cp=new y_(1,1),E_=new h_,T_=new Dx,S_=new __,Pp=[],Dp=[],Lp=new Float32Array(16),Np=new Float32Array(9),Up=new Float32Array(4);function lo(i,t,e){const n=i[0];if(n<=0||n>0)return i;const s=t*e;let r=Pp[s];if(r===void 0&&(r=new Float32Array(s),Pp[s]=r),t!==0){n.toArray(r,0);for(let o=1,a=0;o!==t;++o)a+=e,i[o].toArray(r,a)}return r}function tn(i,t){if(i.length!==t.length)return!1;for(let e=0,n=i.length;e<n;e++)if(i[e]!==t[e])return!1;return!0}function en(i,t){for(let e=0,n=t.length;e<n;e++)i[e]=t[e]}function wl(i,t){let e=Dp[t];e===void 0&&(e=new Int32Array(t),Dp[t]=e);for(let n=0;n!==t;++n)e[n]=i.allocateTextureUnit();return e}function jS(i,t){const e=this.cache;e[0]!==t&&(i.uniform1f(this.addr,t),e[0]=t)}function KS(i,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(i.uniform2f(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(tn(e,t))return;i.uniform2fv(this.addr,t),en(e,t)}}function $S(i,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(i.uniform3f(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else if(t.r!==void 0)(e[0]!==t.r||e[1]!==t.g||e[2]!==t.b)&&(i.uniform3f(this.addr,t.r,t.g,t.b),e[0]=t.r,e[1]=t.g,e[2]=t.b);else{if(tn(e,t))return;i.uniform3fv(this.addr,t),en(e,t)}}function YS(i,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(i.uniform4f(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(tn(e,t))return;i.uniform4fv(this.addr,t),en(e,t)}}function JS(i,t){const e=this.cache,n=t.elements;if(n===void 0){if(tn(e,t))return;i.uniformMatrix2fv(this.addr,!1,t),en(e,t)}else{if(tn(e,n))return;Up.set(n),i.uniformMatrix2fv(this.addr,!1,Up),en(e,n)}}function ZS(i,t){const e=this.cache,n=t.elements;if(n===void 0){if(tn(e,t))return;i.uniformMatrix3fv(this.addr,!1,t),en(e,t)}else{if(tn(e,n))return;Np.set(n),i.uniformMatrix3fv(this.addr,!1,Np),en(e,n)}}function QS(i,t){const e=this.cache,n=t.elements;if(n===void 0){if(tn(e,t))return;i.uniformMatrix4fv(this.addr,!1,t),en(e,t)}else{if(tn(e,n))return;Lp.set(n),i.uniformMatrix4fv(this.addr,!1,Lp),en(e,n)}}function tA(i,t){const e=this.cache;e[0]!==t&&(i.uniform1i(this.addr,t),e[0]=t)}function eA(i,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(i.uniform2i(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(tn(e,t))return;i.uniform2iv(this.addr,t),en(e,t)}}function nA(i,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(i.uniform3i(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else{if(tn(e,t))return;i.uniform3iv(this.addr,t),en(e,t)}}function iA(i,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(i.uniform4i(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(tn(e,t))return;i.uniform4iv(this.addr,t),en(e,t)}}function sA(i,t){const e=this.cache;e[0]!==t&&(i.uniform1ui(this.addr,t),e[0]=t)}function rA(i,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(i.uniform2ui(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(tn(e,t))return;i.uniform2uiv(this.addr,t),en(e,t)}}function oA(i,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(i.uniform3ui(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else{if(tn(e,t))return;i.uniform3uiv(this.addr,t),en(e,t)}}function aA(i,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(i.uniform4ui(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(tn(e,t))return;i.uniform4uiv(this.addr,t),en(e,t)}}function cA(i,t,e){const n=this.cache,s=e.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s);let r;this.type===i.SAMPLER_2D_SHADOW?(Cp.compareFunction=c_,r=Cp):r=x_,e.setTexture2D(t||r,s)}function lA(i,t,e){const n=this.cache,s=e.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),e.setTexture3D(t||T_,s)}function uA(i,t,e){const n=this.cache,s=e.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),e.setTextureCube(t||S_,s)}function hA(i,t,e){const n=this.cache,s=e.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),e.setTexture2DArray(t||E_,s)}function dA(i){switch(i){case 5126:return jS;case 35664:return KS;case 35665:return $S;case 35666:return YS;case 35674:return JS;case 35675:return ZS;case 35676:return QS;case 5124:case 35670:return tA;case 35667:case 35671:return eA;case 35668:case 35672:return nA;case 35669:case 35673:return iA;case 5125:return sA;case 36294:return rA;case 36295:return oA;case 36296:return aA;case 35678:case 36198:case 36298:case 36306:case 35682:return cA;case 35679:case 36299:case 36307:return lA;case 35680:case 36300:case 36308:case 36293:return uA;case 36289:case 36303:case 36311:case 36292:return hA}}function fA(i,t){i.uniform1fv(this.addr,t)}function pA(i,t){const e=lo(t,this.size,2);i.uniform2fv(this.addr,e)}function mA(i,t){const e=lo(t,this.size,3);i.uniform3fv(this.addr,e)}function gA(i,t){const e=lo(t,this.size,4);i.uniform4fv(this.addr,e)}function _A(i,t){const e=lo(t,this.size,4);i.uniformMatrix2fv(this.addr,!1,e)}function vA(i,t){const e=lo(t,this.size,9);i.uniformMatrix3fv(this.addr,!1,e)}function yA(i,t){const e=lo(t,this.size,16);i.uniformMatrix4fv(this.addr,!1,e)}function xA(i,t){i.uniform1iv(this.addr,t)}function EA(i,t){i.uniform2iv(this.addr,t)}function TA(i,t){i.uniform3iv(this.addr,t)}function SA(i,t){i.uniform4iv(this.addr,t)}function AA(i,t){i.uniform1uiv(this.addr,t)}function MA(i,t){i.uniform2uiv(this.addr,t)}function wA(i,t){i.uniform3uiv(this.addr,t)}function bA(i,t){i.uniform4uiv(this.addr,t)}function RA(i,t,e){const n=this.cache,s=t.length,r=wl(e,s);tn(n,r)||(i.uniform1iv(this.addr,r),en(n,r));for(let o=0;o!==s;++o)e.setTexture2D(t[o]||x_,r[o])}function IA(i,t,e){const n=this.cache,s=t.length,r=wl(e,s);tn(n,r)||(i.uniform1iv(this.addr,r),en(n,r));for(let o=0;o!==s;++o)e.setTexture3D(t[o]||T_,r[o])}function CA(i,t,e){const n=this.cache,s=t.length,r=wl(e,s);tn(n,r)||(i.uniform1iv(this.addr,r),en(n,r));for(let o=0;o!==s;++o)e.setTextureCube(t[o]||S_,r[o])}function PA(i,t,e){const n=this.cache,s=t.length,r=wl(e,s);tn(n,r)||(i.uniform1iv(this.addr,r),en(n,r));for(let o=0;o!==s;++o)e.setTexture2DArray(t[o]||E_,r[o])}function DA(i){switch(i){case 5126:return fA;case 35664:return pA;case 35665:return mA;case 35666:return gA;case 35674:return _A;case 35675:return vA;case 35676:return yA;case 5124:case 35670:return xA;case 35667:case 35671:return EA;case 35668:case 35672:return TA;case 35669:case 35673:return SA;case 5125:return AA;case 36294:return MA;case 36295:return wA;case 36296:return bA;case 35678:case 36198:case 36298:case 36306:case 35682:return RA;case 35679:case 36299:case 36307:return IA;case 35680:case 36300:case 36308:case 36293:return CA;case 36289:case 36303:case 36311:case 36292:return PA}}class LA{constructor(t,e,n){this.id=t,this.addr=n,this.cache=[],this.type=e.type,this.setValue=dA(e.type)}}class NA{constructor(t,e,n){this.id=t,this.addr=n,this.cache=[],this.type=e.type,this.size=e.size,this.setValue=DA(e.type)}}class UA{constructor(t){this.id=t,this.seq=[],this.map={}}setValue(t,e,n){const s=this.seq;for(let r=0,o=s.length;r!==o;++r){const a=s[r];a.setValue(t,e[a.id],n)}}}const Su=/(\w+)(\])?(\[|\.)?/g;function Op(i,t){i.seq.push(t),i.map[t.id]=t}function OA(i,t,e){const n=i.name,s=n.length;for(Su.lastIndex=0;;){const r=Su.exec(n),o=Su.lastIndex;let a=r[1];const c=r[2]==="]",l=r[3];if(c&&(a=a|0),l===void 0||l==="["&&o+2===s){Op(e,l===void 0?new LA(a,i,t):new NA(a,i,t));break}else{let d=e.map[a];d===void 0&&(d=new UA(a),Op(e,d)),e=d}}}class zc{constructor(t,e){this.seq=[],this.map={};const n=t.getProgramParameter(e,t.ACTIVE_UNIFORMS);for(let s=0;s<n;++s){const r=t.getActiveUniform(e,s),o=t.getUniformLocation(e,r.name);OA(r,o,this)}}setValue(t,e,n,s){const r=this.map[e];r!==void 0&&r.setValue(t,n,s)}setOptional(t,e,n){const s=e[n];s!==void 0&&this.setValue(t,n,s)}static upload(t,e,n,s){for(let r=0,o=e.length;r!==o;++r){const a=e[r],c=n[a.id];c.needsUpdate!==!1&&a.setValue(t,c.value,s)}}static seqWithValue(t,e){const n=[];for(let s=0,r=t.length;s!==r;++s){const o=t[s];o.id in e&&n.push(o)}return n}}function Fp(i,t,e){const n=i.createShader(t);return i.shaderSource(n,e),i.compileShader(n),n}const FA=37297;let VA=0;function BA(i,t){const e=i.split(`
`),n=[],s=Math.max(t-6,0),r=Math.min(t+6,e.length);for(let o=s;o<r;o++){const a=o+1;n.push(`${a===t?">":" "} ${a}: ${e[o]}`)}return n.join(`
`)}function kA(i){const t=me.getPrimaries(me.workingColorSpace),e=me.getPrimaries(i);let n;switch(t===e?n="":t===tl&&e===Qc?n="LinearDisplayP3ToLinearSRGB":t===Qc&&e===tl&&(n="LinearSRGBToLinearDisplayP3"),i){case fn:case Ml:return[n,"LinearTransferOETF"];case hn:case Md:return[n,"sRGBTransferOETF"];default:return console.warn("THREE.WebGLProgram: Unsupported color space:",i),[n,"LinearTransferOETF"]}}function Vp(i,t,e){const n=i.getShaderParameter(t,i.COMPILE_STATUS),s=i.getShaderInfoLog(t).trim();if(n&&s==="")return"";const r=/ERROR: 0:(\d+)/.exec(s);if(r){const o=parseInt(r[1]);return e.toUpperCase()+`

`+s+`

`+BA(i.getShaderSource(t),o)}else return s}function zA(i,t){const e=kA(t);return`vec4 ${i}( vec4 value ) { return ${e[0]}( ${e[1]}( value ) ); }`}function HA(i,t){let e;switch(t){case Fy:e="Linear";break;case Vy:e="Reinhard";break;case By:e="Cineon";break;case ky:e="ACESFilmic";break;case Hy:e="AgX";break;case Gy:e="Neutral";break;case zy:e="Custom";break;default:console.warn("THREE.WebGLProgram: Unsupported toneMapping:",t),e="Linear"}return"vec3 "+i+"( vec3 color ) { return "+e+"ToneMapping( color ); }"}const mc=new O;function GA(){me.getLuminanceCoefficients(mc);const i=mc.x.toFixed(4),t=mc.y.toFixed(4),e=mc.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${i}, ${t}, ${e} );`,"	return dot( weights, rgb );","}"].join(`
`)}function WA(i){return[i.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",i.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(Xo).join(`
`)}function XA(i){const t=[];for(const e in i){const n=i[e];n!==!1&&t.push("#define "+e+" "+n)}return t.join(`
`)}function qA(i,t){const e={},n=i.getProgramParameter(t,i.ACTIVE_ATTRIBUTES);for(let s=0;s<n;s++){const r=i.getActiveAttrib(t,s),o=r.name;let a=1;r.type===i.FLOAT_MAT2&&(a=2),r.type===i.FLOAT_MAT3&&(a=3),r.type===i.FLOAT_MAT4&&(a=4),e[o]={type:r.type,location:i.getAttribLocation(t,o),locationSize:a}}return e}function Xo(i){return i!==""}function Bp(i,t){const e=t.numSpotLightShadows+t.numSpotLightMaps-t.numSpotLightShadowsWithMaps;return i.replace(/NUM_DIR_LIGHTS/g,t.numDirLights).replace(/NUM_SPOT_LIGHTS/g,t.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,t.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,e).replace(/NUM_RECT_AREA_LIGHTS/g,t.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,t.numPointLights).replace(/NUM_HEMI_LIGHTS/g,t.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,t.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,t.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,t.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,t.numPointLightShadows)}function kp(i,t){return i.replace(/NUM_CLIPPING_PLANES/g,t.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,t.numClippingPlanes-t.numClipIntersection)}const jA=/^[ \t]*#include +<([\w\d./]+)>/gm;function Oh(i){return i.replace(jA,$A)}const KA=new Map;function $A(i,t){let e=Yt[t];if(e===void 0){const n=KA.get(t);if(n!==void 0)e=Yt[n],console.warn('THREE.WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',t,n);else throw new Error("Can not resolve #include <"+t+">")}return Oh(e)}const YA=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function zp(i){return i.replace(YA,JA)}function JA(i,t,e,n){let s="";for(let r=parseInt(t);r<parseInt(e);r++)s+=n.replace(/\[\s*i\s*\]/g,"[ "+r+" ]").replace(/UNROLLED_LOOP_INDEX/g,r);return s}function Hp(i){let t=`precision ${i.precision} float;
	precision ${i.precision} int;
	precision ${i.precision} sampler2D;
	precision ${i.precision} samplerCube;
	precision ${i.precision} sampler3D;
	precision ${i.precision} sampler2DArray;
	precision ${i.precision} sampler2DShadow;
	precision ${i.precision} samplerCubeShadow;
	precision ${i.precision} sampler2DArrayShadow;
	precision ${i.precision} isampler2D;
	precision ${i.precision} isampler3D;
	precision ${i.precision} isamplerCube;
	precision ${i.precision} isampler2DArray;
	precision ${i.precision} usampler2D;
	precision ${i.precision} usampler3D;
	precision ${i.precision} usamplerCube;
	precision ${i.precision} usampler2DArray;
	`;return i.precision==="highp"?t+=`
#define HIGH_PRECISION`:i.precision==="mediump"?t+=`
#define MEDIUM_PRECISION`:i.precision==="lowp"&&(t+=`
#define LOW_PRECISION`),t}function ZA(i){let t="SHADOWMAP_TYPE_BASIC";return i.shadowMapType===$g?t="SHADOWMAP_TYPE_PCF":i.shadowMapType===gy?t="SHADOWMAP_TYPE_PCF_SOFT":i.shadowMapType===Ui&&(t="SHADOWMAP_TYPE_VSM"),t}function QA(i){let t="ENVMAP_TYPE_CUBE";if(i.envMap)switch(i.envMapMode){case jr:case Kr:t="ENVMAP_TYPE_CUBE";break;case Al:t="ENVMAP_TYPE_CUBE_UV";break}return t}function tM(i){let t="ENVMAP_MODE_REFLECTION";if(i.envMap)switch(i.envMapMode){case Kr:t="ENVMAP_MODE_REFRACTION";break}return t}function eM(i){let t="ENVMAP_BLENDING_NONE";if(i.envMap)switch(i.combine){case md:t="ENVMAP_BLENDING_MULTIPLY";break;case Uy:t="ENVMAP_BLENDING_MIX";break;case Oy:t="ENVMAP_BLENDING_ADD";break}return t}function nM(i){const t=i.envMapCubeUVHeight;if(t===null)return null;const e=Math.log2(t)-2,n=1/t;return{texelWidth:1/(3*Math.max(Math.pow(2,e),7*16)),texelHeight:n,maxMip:e}}function iM(i,t,e,n){const s=i.getContext(),r=e.defines;let o=e.vertexShader,a=e.fragmentShader;const c=ZA(e),l=QA(e),h=tM(e),d=eM(e),f=nM(e),p=WA(e),v=XA(r),x=s.createProgram();let m,_,A=e.glslVersion?"#version "+e.glslVersion+`
`:"";e.isRawShaderMaterial?(m=["#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,v].filter(Xo).join(`
`),m.length>0&&(m+=`
`),_=["#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,v].filter(Xo).join(`
`),_.length>0&&(_+=`
`)):(m=[Hp(e),"#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,v,e.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",e.batching?"#define USE_BATCHING":"",e.batchingColor?"#define USE_BATCHING_COLOR":"",e.instancing?"#define USE_INSTANCING":"",e.instancingColor?"#define USE_INSTANCING_COLOR":"",e.instancingMorph?"#define USE_INSTANCING_MORPH":"",e.useFog&&e.fog?"#define USE_FOG":"",e.useFog&&e.fogExp2?"#define FOG_EXP2":"",e.map?"#define USE_MAP":"",e.envMap?"#define USE_ENVMAP":"",e.envMap?"#define "+h:"",e.lightMap?"#define USE_LIGHTMAP":"",e.aoMap?"#define USE_AOMAP":"",e.bumpMap?"#define USE_BUMPMAP":"",e.normalMap?"#define USE_NORMALMAP":"",e.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",e.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",e.displacementMap?"#define USE_DISPLACEMENTMAP":"",e.emissiveMap?"#define USE_EMISSIVEMAP":"",e.anisotropy?"#define USE_ANISOTROPY":"",e.anisotropyMap?"#define USE_ANISOTROPYMAP":"",e.clearcoatMap?"#define USE_CLEARCOATMAP":"",e.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",e.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",e.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",e.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",e.specularMap?"#define USE_SPECULARMAP":"",e.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",e.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",e.roughnessMap?"#define USE_ROUGHNESSMAP":"",e.metalnessMap?"#define USE_METALNESSMAP":"",e.alphaMap?"#define USE_ALPHAMAP":"",e.alphaHash?"#define USE_ALPHAHASH":"",e.transmission?"#define USE_TRANSMISSION":"",e.transmissionMap?"#define USE_TRANSMISSIONMAP":"",e.thicknessMap?"#define USE_THICKNESSMAP":"",e.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",e.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",e.mapUv?"#define MAP_UV "+e.mapUv:"",e.alphaMapUv?"#define ALPHAMAP_UV "+e.alphaMapUv:"",e.lightMapUv?"#define LIGHTMAP_UV "+e.lightMapUv:"",e.aoMapUv?"#define AOMAP_UV "+e.aoMapUv:"",e.emissiveMapUv?"#define EMISSIVEMAP_UV "+e.emissiveMapUv:"",e.bumpMapUv?"#define BUMPMAP_UV "+e.bumpMapUv:"",e.normalMapUv?"#define NORMALMAP_UV "+e.normalMapUv:"",e.displacementMapUv?"#define DISPLACEMENTMAP_UV "+e.displacementMapUv:"",e.metalnessMapUv?"#define METALNESSMAP_UV "+e.metalnessMapUv:"",e.roughnessMapUv?"#define ROUGHNESSMAP_UV "+e.roughnessMapUv:"",e.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+e.anisotropyMapUv:"",e.clearcoatMapUv?"#define CLEARCOATMAP_UV "+e.clearcoatMapUv:"",e.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+e.clearcoatNormalMapUv:"",e.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+e.clearcoatRoughnessMapUv:"",e.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+e.iridescenceMapUv:"",e.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+e.iridescenceThicknessMapUv:"",e.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+e.sheenColorMapUv:"",e.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+e.sheenRoughnessMapUv:"",e.specularMapUv?"#define SPECULARMAP_UV "+e.specularMapUv:"",e.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+e.specularColorMapUv:"",e.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+e.specularIntensityMapUv:"",e.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+e.transmissionMapUv:"",e.thicknessMapUv?"#define THICKNESSMAP_UV "+e.thicknessMapUv:"",e.vertexTangents&&e.flatShading===!1?"#define USE_TANGENT":"",e.vertexColors?"#define USE_COLOR":"",e.vertexAlphas?"#define USE_COLOR_ALPHA":"",e.vertexUv1s?"#define USE_UV1":"",e.vertexUv2s?"#define USE_UV2":"",e.vertexUv3s?"#define USE_UV3":"",e.pointsUvs?"#define USE_POINTS_UV":"",e.flatShading?"#define FLAT_SHADED":"",e.skinning?"#define USE_SKINNING":"",e.morphTargets?"#define USE_MORPHTARGETS":"",e.morphNormals&&e.flatShading===!1?"#define USE_MORPHNORMALS":"",e.morphColors?"#define USE_MORPHCOLORS":"",e.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+e.morphTextureStride:"",e.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+e.morphTargetsCount:"",e.doubleSided?"#define DOUBLE_SIDED":"",e.flipSided?"#define FLIP_SIDED":"",e.shadowMapEnabled?"#define USE_SHADOWMAP":"",e.shadowMapEnabled?"#define "+c:"",e.sizeAttenuation?"#define USE_SIZEATTENUATION":"",e.numLightProbes>0?"#define USE_LIGHT_PROBES":"",e.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"",e.reverseDepthBuffer?"#define USE_REVERSEDEPTHBUF":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(Xo).join(`
`),_=[Hp(e),"#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,v,e.useFog&&e.fog?"#define USE_FOG":"",e.useFog&&e.fogExp2?"#define FOG_EXP2":"",e.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",e.map?"#define USE_MAP":"",e.matcap?"#define USE_MATCAP":"",e.envMap?"#define USE_ENVMAP":"",e.envMap?"#define "+l:"",e.envMap?"#define "+h:"",e.envMap?"#define "+d:"",f?"#define CUBEUV_TEXEL_WIDTH "+f.texelWidth:"",f?"#define CUBEUV_TEXEL_HEIGHT "+f.texelHeight:"",f?"#define CUBEUV_MAX_MIP "+f.maxMip+".0":"",e.lightMap?"#define USE_LIGHTMAP":"",e.aoMap?"#define USE_AOMAP":"",e.bumpMap?"#define USE_BUMPMAP":"",e.normalMap?"#define USE_NORMALMAP":"",e.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",e.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",e.emissiveMap?"#define USE_EMISSIVEMAP":"",e.anisotropy?"#define USE_ANISOTROPY":"",e.anisotropyMap?"#define USE_ANISOTROPYMAP":"",e.clearcoat?"#define USE_CLEARCOAT":"",e.clearcoatMap?"#define USE_CLEARCOATMAP":"",e.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",e.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",e.dispersion?"#define USE_DISPERSION":"",e.iridescence?"#define USE_IRIDESCENCE":"",e.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",e.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",e.specularMap?"#define USE_SPECULARMAP":"",e.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",e.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",e.roughnessMap?"#define USE_ROUGHNESSMAP":"",e.metalnessMap?"#define USE_METALNESSMAP":"",e.alphaMap?"#define USE_ALPHAMAP":"",e.alphaTest?"#define USE_ALPHATEST":"",e.alphaHash?"#define USE_ALPHAHASH":"",e.sheen?"#define USE_SHEEN":"",e.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",e.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",e.transmission?"#define USE_TRANSMISSION":"",e.transmissionMap?"#define USE_TRANSMISSIONMAP":"",e.thicknessMap?"#define USE_THICKNESSMAP":"",e.vertexTangents&&e.flatShading===!1?"#define USE_TANGENT":"",e.vertexColors||e.instancingColor||e.batchingColor?"#define USE_COLOR":"",e.vertexAlphas?"#define USE_COLOR_ALPHA":"",e.vertexUv1s?"#define USE_UV1":"",e.vertexUv2s?"#define USE_UV2":"",e.vertexUv3s?"#define USE_UV3":"",e.pointsUvs?"#define USE_POINTS_UV":"",e.gradientMap?"#define USE_GRADIENTMAP":"",e.flatShading?"#define FLAT_SHADED":"",e.doubleSided?"#define DOUBLE_SIDED":"",e.flipSided?"#define FLIP_SIDED":"",e.shadowMapEnabled?"#define USE_SHADOWMAP":"",e.shadowMapEnabled?"#define "+c:"",e.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",e.numLightProbes>0?"#define USE_LIGHT_PROBES":"",e.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",e.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"",e.reverseDepthBuffer?"#define USE_REVERSEDEPTHBUF":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",e.toneMapping!==ls?"#define TONE_MAPPING":"",e.toneMapping!==ls?Yt.tonemapping_pars_fragment:"",e.toneMapping!==ls?HA("toneMapping",e.toneMapping):"",e.dithering?"#define DITHERING":"",e.opaque?"#define OPAQUE":"",Yt.colorspace_pars_fragment,zA("linearToOutputTexel",e.outputColorSpace),GA(),e.useDepthPacking?"#define DEPTH_PACKING "+e.depthPacking:"",`
`].filter(Xo).join(`
`)),o=Oh(o),o=Bp(o,e),o=kp(o,e),a=Oh(a),a=Bp(a,e),a=kp(a,e),o=zp(o),a=zp(a),e.isRawShaderMaterial!==!0&&(A=`#version 300 es
`,m=[p,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+m,_=["#define varying in",e.glslVersion===sp?"":"layout(location = 0) out highp vec4 pc_fragColor;",e.glslVersion===sp?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+_);const S=A+m+o,b=A+_+a,F=Fp(s,s.VERTEX_SHADER,S),N=Fp(s,s.FRAGMENT_SHADER,b);s.attachShader(x,F),s.attachShader(x,N),e.index0AttributeName!==void 0?s.bindAttribLocation(x,0,e.index0AttributeName):e.morphTargets===!0&&s.bindAttribLocation(x,0,"position"),s.linkProgram(x);function M(E){if(i.debug.checkShaderErrors){const L=s.getProgramInfoLog(x).trim(),R=s.getShaderInfoLog(F).trim(),q=s.getShaderInfoLog(N).trim();let nt=!0,j=!0;if(s.getProgramParameter(x,s.LINK_STATUS)===!1)if(nt=!1,typeof i.debug.onShaderError=="function")i.debug.onShaderError(s,x,F,N);else{const ot=Vp(s,F,"vertex"),Y=Vp(s,N,"fragment");console.error("THREE.WebGLProgram: Shader Error "+s.getError()+" - VALIDATE_STATUS "+s.getProgramParameter(x,s.VALIDATE_STATUS)+`

Material Name: `+E.name+`
Material Type: `+E.type+`

Program Info Log: `+L+`
`+ot+`
`+Y)}else L!==""?console.warn("THREE.WebGLProgram: Program Info Log:",L):(R===""||q==="")&&(j=!1);j&&(E.diagnostics={runnable:nt,programLog:L,vertexShader:{log:R,prefix:m},fragmentShader:{log:q,prefix:_}})}s.deleteShader(F),s.deleteShader(N),w=new zc(s,x),C=qA(s,x)}let w;this.getUniforms=function(){return w===void 0&&M(this),w};let C;this.getAttributes=function(){return C===void 0&&M(this),C};let y=e.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return y===!1&&(y=s.getProgramParameter(x,FA)),y},this.destroy=function(){n.releaseStatesOfProgram(this),s.deleteProgram(x),this.program=void 0},this.type=e.shaderType,this.name=e.shaderName,this.id=VA++,this.cacheKey=t,this.usedTimes=1,this.program=x,this.vertexShader=F,this.fragmentShader=N,this}let sM=0;class rM{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(t){const e=t.vertexShader,n=t.fragmentShader,s=this._getShaderStage(e),r=this._getShaderStage(n),o=this._getShaderCacheForMaterial(t);return o.has(s)===!1&&(o.add(s),s.usedTimes++),o.has(r)===!1&&(o.add(r),r.usedTimes++),this}remove(t){const e=this.materialCache.get(t);for(const n of e)n.usedTimes--,n.usedTimes===0&&this.shaderCache.delete(n.code);return this.materialCache.delete(t),this}getVertexShaderID(t){return this._getShaderStage(t.vertexShader).id}getFragmentShaderID(t){return this._getShaderStage(t.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(t){const e=this.materialCache;let n=e.get(t);return n===void 0&&(n=new Set,e.set(t,n)),n}_getShaderStage(t){const e=this.shaderCache;let n=e.get(t);return n===void 0&&(n=new oM(t),e.set(t,n)),n}}class oM{constructor(t){this.id=sM++,this.code=t,this.usedTimes=0}}function aM(i,t,e,n,s,r,o){const a=new bd,c=new rM,l=new Set,h=[],d=s.logarithmicDepthBuffer,f=s.reverseDepthBuffer,p=s.vertexTextures;let v=s.precision;const x={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distanceRGBA",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function m(y){return l.add(y),y===0?"uv":`uv${y}`}function _(y,E,L,R,q){const nt=R.fog,j=q.geometry,ot=y.isMeshStandardMaterial?R.environment:null,Y=(y.isMeshStandardMaterial?e:t).get(y.envMap||ot),Et=Y&&Y.mapping===Al?Y.image.height:null,Tt=x[y.type];y.precision!==null&&(v=s.getMaxPrecision(y.precision),v!==y.precision&&console.warn("THREE.WebGLProgram.getParameters:",y.precision,"not supported, using",v,"instead."));const Ct=j.morphAttributes.position||j.morphAttributes.normal||j.morphAttributes.color,$t=Ct!==void 0?Ct.length:0;let Ht=0;j.morphAttributes.position!==void 0&&(Ht=1),j.morphAttributes.normal!==void 0&&(Ht=2),j.morphAttributes.color!==void 0&&(Ht=3);let J,rt,bt,vt;if(Tt){const ze=fi[Tt];J=ze.vertexShader,rt=ze.fragmentShader}else J=y.vertexShader,rt=y.fragmentShader,c.update(y),bt=c.getVertexShaderID(y),vt=c.getFragmentShaderID(y);const Xt=i.getRenderTarget(),Vt=q.isInstancedMesh===!0,Qt=q.isBatchedMesh===!0,ue=!!y.map,ne=!!y.matcap,V=!!Y,cn=!!y.aoMap,te=!!y.lightMap,re=!!y.bumpMap,kt=!!y.normalMap,Te=!!y.displacementMap,zt=!!y.emissiveMap,U=!!y.metalnessMap,I=!!y.roughnessMap,G=y.anisotropy>0,Z=y.clearcoat>0,st=y.dispersion>0,Q=y.iridescence>0,ft=y.sheen>0,at=y.transmission>0,yt=G&&!!y.anisotropyMap,oe=Z&&!!y.clearcoatMap,ct=Z&&!!y.clearcoatNormalMap,Mt=Z&&!!y.clearcoatRoughnessMap,Ut=Q&&!!y.iridescenceMap,Bt=Q&&!!y.iridescenceThicknessMap,St=ft&&!!y.sheenColorMap,ee=ft&&!!y.sheenRoughnessMap,qt=!!y.specularMap,Ee=!!y.specularColorMap,B=!!y.specularIntensityMap,_t=at&&!!y.transmissionMap,$=at&&!!y.thicknessMap,et=!!y.gradientMap,pt=!!y.alphaMap,mt=y.alphaTest>0,Kt=!!y.alphaHash,Ne=!!y.extensions;let je=ls;y.toneMapped&&(Xt===null||Xt.isXRRenderTarget===!0)&&(je=i.toneMapping);const ae={shaderID:Tt,shaderType:y.type,shaderName:y.name,vertexShader:J,fragmentShader:rt,defines:y.defines,customVertexShaderID:bt,customFragmentShaderID:vt,isRawShaderMaterial:y.isRawShaderMaterial===!0,glslVersion:y.glslVersion,precision:v,batching:Qt,batchingColor:Qt&&q._colorsTexture!==null,instancing:Vt,instancingColor:Vt&&q.instanceColor!==null,instancingMorph:Vt&&q.morphTexture!==null,supportsVertexTextures:p,outputColorSpace:Xt===null?i.outputColorSpace:Xt.isXRRenderTarget===!0?Xt.texture.colorSpace:fn,alphaToCoverage:!!y.alphaToCoverage,map:ue,matcap:ne,envMap:V,envMapMode:V&&Y.mapping,envMapCubeUVHeight:Et,aoMap:cn,lightMap:te,bumpMap:re,normalMap:kt,displacementMap:p&&Te,emissiveMap:zt,normalMapObjectSpace:kt&&y.normalMapType===Zy,normalMapTangentSpace:kt&&y.normalMapType===Ad,metalnessMap:U,roughnessMap:I,anisotropy:G,anisotropyMap:yt,clearcoat:Z,clearcoatMap:oe,clearcoatNormalMap:ct,clearcoatRoughnessMap:Mt,dispersion:st,iridescence:Q,iridescenceMap:Ut,iridescenceThicknessMap:Bt,sheen:ft,sheenColorMap:St,sheenRoughnessMap:ee,specularMap:qt,specularColorMap:Ee,specularIntensityMap:B,transmission:at,transmissionMap:_t,thicknessMap:$,gradientMap:et,opaque:y.transparent===!1&&y.blending===Br&&y.alphaToCoverage===!1,alphaMap:pt,alphaTest:mt,alphaHash:Kt,combine:y.combine,mapUv:ue&&m(y.map.channel),aoMapUv:cn&&m(y.aoMap.channel),lightMapUv:te&&m(y.lightMap.channel),bumpMapUv:re&&m(y.bumpMap.channel),normalMapUv:kt&&m(y.normalMap.channel),displacementMapUv:Te&&m(y.displacementMap.channel),emissiveMapUv:zt&&m(y.emissiveMap.channel),metalnessMapUv:U&&m(y.metalnessMap.channel),roughnessMapUv:I&&m(y.roughnessMap.channel),anisotropyMapUv:yt&&m(y.anisotropyMap.channel),clearcoatMapUv:oe&&m(y.clearcoatMap.channel),clearcoatNormalMapUv:ct&&m(y.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:Mt&&m(y.clearcoatRoughnessMap.channel),iridescenceMapUv:Ut&&m(y.iridescenceMap.channel),iridescenceThicknessMapUv:Bt&&m(y.iridescenceThicknessMap.channel),sheenColorMapUv:St&&m(y.sheenColorMap.channel),sheenRoughnessMapUv:ee&&m(y.sheenRoughnessMap.channel),specularMapUv:qt&&m(y.specularMap.channel),specularColorMapUv:Ee&&m(y.specularColorMap.channel),specularIntensityMapUv:B&&m(y.specularIntensityMap.channel),transmissionMapUv:_t&&m(y.transmissionMap.channel),thicknessMapUv:$&&m(y.thicknessMap.channel),alphaMapUv:pt&&m(y.alphaMap.channel),vertexTangents:!!j.attributes.tangent&&(kt||G),vertexColors:y.vertexColors,vertexAlphas:y.vertexColors===!0&&!!j.attributes.color&&j.attributes.color.itemSize===4,pointsUvs:q.isPoints===!0&&!!j.attributes.uv&&(ue||pt),fog:!!nt,useFog:y.fog===!0,fogExp2:!!nt&&nt.isFogExp2,flatShading:y.flatShading===!0,sizeAttenuation:y.sizeAttenuation===!0,logarithmicDepthBuffer:d,reverseDepthBuffer:f,skinning:q.isSkinnedMesh===!0,morphTargets:j.morphAttributes.position!==void 0,morphNormals:j.morphAttributes.normal!==void 0,morphColors:j.morphAttributes.color!==void 0,morphTargetsCount:$t,morphTextureStride:Ht,numDirLights:E.directional.length,numPointLights:E.point.length,numSpotLights:E.spot.length,numSpotLightMaps:E.spotLightMap.length,numRectAreaLights:E.rectArea.length,numHemiLights:E.hemi.length,numDirLightShadows:E.directionalShadowMap.length,numPointLightShadows:E.pointShadowMap.length,numSpotLightShadows:E.spotShadowMap.length,numSpotLightShadowsWithMaps:E.numSpotLightShadowsWithMaps,numLightProbes:E.numLightProbes,numClippingPlanes:o.numPlanes,numClipIntersection:o.numIntersection,dithering:y.dithering,shadowMapEnabled:i.shadowMap.enabled&&L.length>0,shadowMapType:i.shadowMap.type,toneMapping:je,decodeVideoTexture:ue&&y.map.isVideoTexture===!0&&me.getTransfer(y.map.colorSpace)===Ie,premultipliedAlpha:y.premultipliedAlpha,doubleSided:y.side===ei,flipSided:y.side===Dn,useDepthPacking:y.depthPacking>=0,depthPacking:y.depthPacking||0,index0AttributeName:y.index0AttributeName,extensionClipCullDistance:Ne&&y.extensions.clipCullDistance===!0&&n.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(Ne&&y.extensions.multiDraw===!0||Qt)&&n.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:n.has("KHR_parallel_shader_compile"),customProgramCacheKey:y.customProgramCacheKey()};return ae.vertexUv1s=l.has(1),ae.vertexUv2s=l.has(2),ae.vertexUv3s=l.has(3),l.clear(),ae}function A(y){const E=[];if(y.shaderID?E.push(y.shaderID):(E.push(y.customVertexShaderID),E.push(y.customFragmentShaderID)),y.defines!==void 0)for(const L in y.defines)E.push(L),E.push(y.defines[L]);return y.isRawShaderMaterial===!1&&(S(E,y),b(E,y),E.push(i.outputColorSpace)),E.push(y.customProgramCacheKey),E.join()}function S(y,E){y.push(E.precision),y.push(E.outputColorSpace),y.push(E.envMapMode),y.push(E.envMapCubeUVHeight),y.push(E.mapUv),y.push(E.alphaMapUv),y.push(E.lightMapUv),y.push(E.aoMapUv),y.push(E.bumpMapUv),y.push(E.normalMapUv),y.push(E.displacementMapUv),y.push(E.emissiveMapUv),y.push(E.metalnessMapUv),y.push(E.roughnessMapUv),y.push(E.anisotropyMapUv),y.push(E.clearcoatMapUv),y.push(E.clearcoatNormalMapUv),y.push(E.clearcoatRoughnessMapUv),y.push(E.iridescenceMapUv),y.push(E.iridescenceThicknessMapUv),y.push(E.sheenColorMapUv),y.push(E.sheenRoughnessMapUv),y.push(E.specularMapUv),y.push(E.specularColorMapUv),y.push(E.specularIntensityMapUv),y.push(E.transmissionMapUv),y.push(E.thicknessMapUv),y.push(E.combine),y.push(E.fogExp2),y.push(E.sizeAttenuation),y.push(E.morphTargetsCount),y.push(E.morphAttributeCount),y.push(E.numDirLights),y.push(E.numPointLights),y.push(E.numSpotLights),y.push(E.numSpotLightMaps),y.push(E.numHemiLights),y.push(E.numRectAreaLights),y.push(E.numDirLightShadows),y.push(E.numPointLightShadows),y.push(E.numSpotLightShadows),y.push(E.numSpotLightShadowsWithMaps),y.push(E.numLightProbes),y.push(E.shadowMapType),y.push(E.toneMapping),y.push(E.numClippingPlanes),y.push(E.numClipIntersection),y.push(E.depthPacking)}function b(y,E){a.disableAll(),E.supportsVertexTextures&&a.enable(0),E.instancing&&a.enable(1),E.instancingColor&&a.enable(2),E.instancingMorph&&a.enable(3),E.matcap&&a.enable(4),E.envMap&&a.enable(5),E.normalMapObjectSpace&&a.enable(6),E.normalMapTangentSpace&&a.enable(7),E.clearcoat&&a.enable(8),E.iridescence&&a.enable(9),E.alphaTest&&a.enable(10),E.vertexColors&&a.enable(11),E.vertexAlphas&&a.enable(12),E.vertexUv1s&&a.enable(13),E.vertexUv2s&&a.enable(14),E.vertexUv3s&&a.enable(15),E.vertexTangents&&a.enable(16),E.anisotropy&&a.enable(17),E.alphaHash&&a.enable(18),E.batching&&a.enable(19),E.dispersion&&a.enable(20),E.batchingColor&&a.enable(21),y.push(a.mask),a.disableAll(),E.fog&&a.enable(0),E.useFog&&a.enable(1),E.flatShading&&a.enable(2),E.logarithmicDepthBuffer&&a.enable(3),E.reverseDepthBuffer&&a.enable(4),E.skinning&&a.enable(5),E.morphTargets&&a.enable(6),E.morphNormals&&a.enable(7),E.morphColors&&a.enable(8),E.premultipliedAlpha&&a.enable(9),E.shadowMapEnabled&&a.enable(10),E.doubleSided&&a.enable(11),E.flipSided&&a.enable(12),E.useDepthPacking&&a.enable(13),E.dithering&&a.enable(14),E.transmission&&a.enable(15),E.sheen&&a.enable(16),E.opaque&&a.enable(17),E.pointsUvs&&a.enable(18),E.decodeVideoTexture&&a.enable(19),E.alphaToCoverage&&a.enable(20),y.push(a.mask)}function F(y){const E=x[y.type];let L;if(E){const R=fi[E];L=Wx.clone(R.uniforms)}else L=y.uniforms;return L}function N(y,E){let L;for(let R=0,q=h.length;R<q;R++){const nt=h[R];if(nt.cacheKey===E){L=nt,++L.usedTimes;break}}return L===void 0&&(L=new iM(i,E,y,r),h.push(L)),L}function M(y){if(--y.usedTimes===0){const E=h.indexOf(y);h[E]=h[h.length-1],h.pop(),y.destroy()}}function w(y){c.remove(y)}function C(){c.dispose()}return{getParameters:_,getProgramCacheKey:A,getUniforms:F,acquireProgram:N,releaseProgram:M,releaseShaderCache:w,programs:h,dispose:C}}function cM(){let i=new WeakMap;function t(o){return i.has(o)}function e(o){let a=i.get(o);return a===void 0&&(a={},i.set(o,a)),a}function n(o){i.delete(o)}function s(o,a,c){i.get(o)[a]=c}function r(){i=new WeakMap}return{has:t,get:e,remove:n,update:s,dispose:r}}function lM(i,t){return i.groupOrder!==t.groupOrder?i.groupOrder-t.groupOrder:i.renderOrder!==t.renderOrder?i.renderOrder-t.renderOrder:i.material.id!==t.material.id?i.material.id-t.material.id:i.z!==t.z?i.z-t.z:i.id-t.id}function Gp(i,t){return i.groupOrder!==t.groupOrder?i.groupOrder-t.groupOrder:i.renderOrder!==t.renderOrder?i.renderOrder-t.renderOrder:i.z!==t.z?t.z-i.z:i.id-t.id}function Wp(){const i=[];let t=0;const e=[],n=[],s=[];function r(){t=0,e.length=0,n.length=0,s.length=0}function o(d,f,p,v,x,m){let _=i[t];return _===void 0?(_={id:d.id,object:d,geometry:f,material:p,groupOrder:v,renderOrder:d.renderOrder,z:x,group:m},i[t]=_):(_.id=d.id,_.object=d,_.geometry=f,_.material=p,_.groupOrder=v,_.renderOrder=d.renderOrder,_.z=x,_.group=m),t++,_}function a(d,f,p,v,x,m){const _=o(d,f,p,v,x,m);p.transmission>0?n.push(_):p.transparent===!0?s.push(_):e.push(_)}function c(d,f,p,v,x,m){const _=o(d,f,p,v,x,m);p.transmission>0?n.unshift(_):p.transparent===!0?s.unshift(_):e.unshift(_)}function l(d,f){e.length>1&&e.sort(d||lM),n.length>1&&n.sort(f||Gp),s.length>1&&s.sort(f||Gp)}function h(){for(let d=t,f=i.length;d<f;d++){const p=i[d];if(p.id===null)break;p.id=null,p.object=null,p.geometry=null,p.material=null,p.group=null}}return{opaque:e,transmissive:n,transparent:s,init:r,push:a,unshift:c,finish:h,sort:l}}function uM(){let i=new WeakMap;function t(n,s){const r=i.get(n);let o;return r===void 0?(o=new Wp,i.set(n,[o])):s>=r.length?(o=new Wp,r.push(o)):o=r[s],o}function e(){i=new WeakMap}return{get:t,dispose:e}}function hM(){const i={};return{get:function(t){if(i[t.id]!==void 0)return i[t.id];let e;switch(t.type){case"DirectionalLight":e={direction:new O,color:new It};break;case"SpotLight":e={position:new O,direction:new O,color:new It,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":e={position:new O,color:new It,distance:0,decay:0};break;case"HemisphereLight":e={direction:new O,skyColor:new It,groundColor:new It};break;case"RectAreaLight":e={color:new It,position:new O,halfWidth:new O,halfHeight:new O};break}return i[t.id]=e,e}}}function dM(){const i={};return{get:function(t){if(i[t.id]!==void 0)return i[t.id];let e;switch(t.type){case"DirectionalLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new dt};break;case"SpotLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new dt};break;case"PointLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new dt,shadowCameraNear:1,shadowCameraFar:1e3};break}return i[t.id]=e,e}}}let fM=0;function pM(i,t){return(t.castShadow?2:0)-(i.castShadow?2:0)+(t.map?1:0)-(i.map?1:0)}function mM(i){const t=new hM,e=dM(),n={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let l=0;l<9;l++)n.probe.push(new O);const s=new O,r=new Gt,o=new Gt;function a(l){let h=0,d=0,f=0;for(let C=0;C<9;C++)n.probe[C].set(0,0,0);let p=0,v=0,x=0,m=0,_=0,A=0,S=0,b=0,F=0,N=0,M=0;l.sort(pM);for(let C=0,y=l.length;C<y;C++){const E=l[C],L=E.color,R=E.intensity,q=E.distance,nt=E.shadow&&E.shadow.map?E.shadow.map.texture:null;if(E.isAmbientLight)h+=L.r*R,d+=L.g*R,f+=L.b*R;else if(E.isLightProbe){for(let j=0;j<9;j++)n.probe[j].addScaledVector(E.sh.coefficients[j],R);M++}else if(E.isDirectionalLight){const j=t.get(E);if(j.color.copy(E.color).multiplyScalar(E.intensity),E.castShadow){const ot=E.shadow,Y=e.get(E);Y.shadowIntensity=ot.intensity,Y.shadowBias=ot.bias,Y.shadowNormalBias=ot.normalBias,Y.shadowRadius=ot.radius,Y.shadowMapSize=ot.mapSize,n.directionalShadow[p]=Y,n.directionalShadowMap[p]=nt,n.directionalShadowMatrix[p]=E.shadow.matrix,A++}n.directional[p]=j,p++}else if(E.isSpotLight){const j=t.get(E);j.position.setFromMatrixPosition(E.matrixWorld),j.color.copy(L).multiplyScalar(R),j.distance=q,j.coneCos=Math.cos(E.angle),j.penumbraCos=Math.cos(E.angle*(1-E.penumbra)),j.decay=E.decay,n.spot[x]=j;const ot=E.shadow;if(E.map&&(n.spotLightMap[F]=E.map,F++,ot.updateMatrices(E),E.castShadow&&N++),n.spotLightMatrix[x]=ot.matrix,E.castShadow){const Y=e.get(E);Y.shadowIntensity=ot.intensity,Y.shadowBias=ot.bias,Y.shadowNormalBias=ot.normalBias,Y.shadowRadius=ot.radius,Y.shadowMapSize=ot.mapSize,n.spotShadow[x]=Y,n.spotShadowMap[x]=nt,b++}x++}else if(E.isRectAreaLight){const j=t.get(E);j.color.copy(L).multiplyScalar(R),j.halfWidth.set(E.width*.5,0,0),j.halfHeight.set(0,E.height*.5,0),n.rectArea[m]=j,m++}else if(E.isPointLight){const j=t.get(E);if(j.color.copy(E.color).multiplyScalar(E.intensity),j.distance=E.distance,j.decay=E.decay,E.castShadow){const ot=E.shadow,Y=e.get(E);Y.shadowIntensity=ot.intensity,Y.shadowBias=ot.bias,Y.shadowNormalBias=ot.normalBias,Y.shadowRadius=ot.radius,Y.shadowMapSize=ot.mapSize,Y.shadowCameraNear=ot.camera.near,Y.shadowCameraFar=ot.camera.far,n.pointShadow[v]=Y,n.pointShadowMap[v]=nt,n.pointShadowMatrix[v]=E.shadow.matrix,S++}n.point[v]=j,v++}else if(E.isHemisphereLight){const j=t.get(E);j.skyColor.copy(E.color).multiplyScalar(R),j.groundColor.copy(E.groundColor).multiplyScalar(R),n.hemi[_]=j,_++}}m>0&&(i.has("OES_texture_float_linear")===!0?(n.rectAreaLTC1=ht.LTC_FLOAT_1,n.rectAreaLTC2=ht.LTC_FLOAT_2):(n.rectAreaLTC1=ht.LTC_HALF_1,n.rectAreaLTC2=ht.LTC_HALF_2)),n.ambient[0]=h,n.ambient[1]=d,n.ambient[2]=f;const w=n.hash;(w.directionalLength!==p||w.pointLength!==v||w.spotLength!==x||w.rectAreaLength!==m||w.hemiLength!==_||w.numDirectionalShadows!==A||w.numPointShadows!==S||w.numSpotShadows!==b||w.numSpotMaps!==F||w.numLightProbes!==M)&&(n.directional.length=p,n.spot.length=x,n.rectArea.length=m,n.point.length=v,n.hemi.length=_,n.directionalShadow.length=A,n.directionalShadowMap.length=A,n.pointShadow.length=S,n.pointShadowMap.length=S,n.spotShadow.length=b,n.spotShadowMap.length=b,n.directionalShadowMatrix.length=A,n.pointShadowMatrix.length=S,n.spotLightMatrix.length=b+F-N,n.spotLightMap.length=F,n.numSpotLightShadowsWithMaps=N,n.numLightProbes=M,w.directionalLength=p,w.pointLength=v,w.spotLength=x,w.rectAreaLength=m,w.hemiLength=_,w.numDirectionalShadows=A,w.numPointShadows=S,w.numSpotShadows=b,w.numSpotMaps=F,w.numLightProbes=M,n.version=fM++)}function c(l,h){let d=0,f=0,p=0,v=0,x=0;const m=h.matrixWorldInverse;for(let _=0,A=l.length;_<A;_++){const S=l[_];if(S.isDirectionalLight){const b=n.directional[d];b.direction.setFromMatrixPosition(S.matrixWorld),s.setFromMatrixPosition(S.target.matrixWorld),b.direction.sub(s),b.direction.transformDirection(m),d++}else if(S.isSpotLight){const b=n.spot[p];b.position.setFromMatrixPosition(S.matrixWorld),b.position.applyMatrix4(m),b.direction.setFromMatrixPosition(S.matrixWorld),s.setFromMatrixPosition(S.target.matrixWorld),b.direction.sub(s),b.direction.transformDirection(m),p++}else if(S.isRectAreaLight){const b=n.rectArea[v];b.position.setFromMatrixPosition(S.matrixWorld),b.position.applyMatrix4(m),o.identity(),r.copy(S.matrixWorld),r.premultiply(m),o.extractRotation(r),b.halfWidth.set(S.width*.5,0,0),b.halfHeight.set(0,S.height*.5,0),b.halfWidth.applyMatrix4(o),b.halfHeight.applyMatrix4(o),v++}else if(S.isPointLight){const b=n.point[f];b.position.setFromMatrixPosition(S.matrixWorld),b.position.applyMatrix4(m),f++}else if(S.isHemisphereLight){const b=n.hemi[x];b.direction.setFromMatrixPosition(S.matrixWorld),b.direction.transformDirection(m),x++}}}return{setup:a,setupView:c,state:n}}function Xp(i){const t=new mM(i),e=[],n=[];function s(h){l.camera=h,e.length=0,n.length=0}function r(h){e.push(h)}function o(h){n.push(h)}function a(){t.setup(e)}function c(h){t.setupView(e,h)}const l={lightsArray:e,shadowsArray:n,camera:null,lights:t,transmissionRenderTarget:{}};return{init:s,state:l,setupLights:a,setupLightsView:c,pushLight:r,pushShadow:o}}function gM(i){let t=new WeakMap;function e(s,r=0){const o=t.get(s);let a;return o===void 0?(a=new Xp(i),t.set(s,[a])):r>=o.length?(a=new Xp(i),o.push(a)):a=o[r],a}function n(){t=new WeakMap}return{get:e,dispose:n}}class _M extends jn{constructor(t){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=Yy,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(t)}copy(t){return super.copy(t),this.depthPacking=t.depthPacking,this.map=t.map,this.alphaMap=t.alphaMap,this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this}}class vM extends jn{constructor(t){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(t)}copy(t){return super.copy(t),this.map=t.map,this.alphaMap=t.alphaMap,this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this}}const yM=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,xM=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
#include <packing>
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = unpackRGBATo2Half( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ) );
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = unpackRGBAToDepth( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ) );
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( squared_mean - mean * mean );
	gl_FragColor = pack2HalfToRGBA( vec2( mean, std_dev ) );
}`;function EM(i,t,e){let n=new Rd;const s=new dt,r=new dt,o=new ge,a=new _M({depthPacking:Jy}),c=new vM,l={},h=e.maxTextureSize,d={[yi]:Dn,[Dn]:yi,[ei]:ei},f=new ms({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new dt},radius:{value:4}},vertexShader:yM,fragmentShader:xM}),p=f.clone();p.defines.HORIZONTAL_PASS=1;const v=new mn;v.setAttribute("position",new An(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));const x=new ve(v,f),m=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=$g;let _=this.type;this.render=function(N,M,w){if(m.enabled===!1||m.autoUpdate===!1&&m.needsUpdate===!1||N.length===0)return;const C=i.getRenderTarget(),y=i.getActiveCubeFace(),E=i.getActiveMipmapLevel(),L=i.state;L.setBlending(cs),L.buffers.color.setClear(1,1,1,1),L.buffers.depth.setTest(!0),L.setScissorTest(!1);const R=_!==Ui&&this.type===Ui,q=_===Ui&&this.type!==Ui;for(let nt=0,j=N.length;nt<j;nt++){const ot=N[nt],Y=ot.shadow;if(Y===void 0){console.warn("THREE.WebGLShadowMap:",ot,"has no shadow.");continue}if(Y.autoUpdate===!1&&Y.needsUpdate===!1)continue;s.copy(Y.mapSize);const Et=Y.getFrameExtents();if(s.multiply(Et),r.copy(Y.mapSize),(s.x>h||s.y>h)&&(s.x>h&&(r.x=Math.floor(h/Et.x),s.x=r.x*Et.x,Y.mapSize.x=r.x),s.y>h&&(r.y=Math.floor(h/Et.y),s.y=r.y*Et.y,Y.mapSize.y=r.y)),Y.map===null||R===!0||q===!0){const Ct=this.type!==Ui?{minFilter:Rn,magFilter:Rn}:{};Y.map!==null&&Y.map.dispose(),Y.map=new Ys(s.x,s.y,Ct),Y.map.texture.name=ot.name+".shadowMap",Y.camera.updateProjectionMatrix()}i.setRenderTarget(Y.map),i.clear();const Tt=Y.getViewportCount();for(let Ct=0;Ct<Tt;Ct++){const $t=Y.getViewport(Ct);o.set(r.x*$t.x,r.y*$t.y,r.x*$t.z,r.y*$t.w),L.viewport(o),Y.updateMatrices(ot,Ct),n=Y.getFrustum(),b(M,w,Y.camera,ot,this.type)}Y.isPointLightShadow!==!0&&this.type===Ui&&A(Y,w),Y.needsUpdate=!1}_=this.type,m.needsUpdate=!1,i.setRenderTarget(C,y,E)};function A(N,M){const w=t.update(x);f.defines.VSM_SAMPLES!==N.blurSamples&&(f.defines.VSM_SAMPLES=N.blurSamples,p.defines.VSM_SAMPLES=N.blurSamples,f.needsUpdate=!0,p.needsUpdate=!0),N.mapPass===null&&(N.mapPass=new Ys(s.x,s.y)),f.uniforms.shadow_pass.value=N.map.texture,f.uniforms.resolution.value=N.mapSize,f.uniforms.radius.value=N.radius,i.setRenderTarget(N.mapPass),i.clear(),i.renderBufferDirect(M,null,w,f,x,null),p.uniforms.shadow_pass.value=N.mapPass.texture,p.uniforms.resolution.value=N.mapSize,p.uniforms.radius.value=N.radius,i.setRenderTarget(N.map),i.clear(),i.renderBufferDirect(M,null,w,p,x,null)}function S(N,M,w,C){let y=null;const E=w.isPointLight===!0?N.customDistanceMaterial:N.customDepthMaterial;if(E!==void 0)y=E;else if(y=w.isPointLight===!0?c:a,i.localClippingEnabled&&M.clipShadows===!0&&Array.isArray(M.clippingPlanes)&&M.clippingPlanes.length!==0||M.displacementMap&&M.displacementScale!==0||M.alphaMap&&M.alphaTest>0||M.map&&M.alphaTest>0){const L=y.uuid,R=M.uuid;let q=l[L];q===void 0&&(q={},l[L]=q);let nt=q[R];nt===void 0&&(nt=y.clone(),q[R]=nt,M.addEventListener("dispose",F)),y=nt}if(y.visible=M.visible,y.wireframe=M.wireframe,C===Ui?y.side=M.shadowSide!==null?M.shadowSide:M.side:y.side=M.shadowSide!==null?M.shadowSide:d[M.side],y.alphaMap=M.alphaMap,y.alphaTest=M.alphaTest,y.map=M.map,y.clipShadows=M.clipShadows,y.clippingPlanes=M.clippingPlanes,y.clipIntersection=M.clipIntersection,y.displacementMap=M.displacementMap,y.displacementScale=M.displacementScale,y.displacementBias=M.displacementBias,y.wireframeLinewidth=M.wireframeLinewidth,y.linewidth=M.linewidth,w.isPointLight===!0&&y.isMeshDistanceMaterial===!0){const L=i.properties.get(y);L.light=w}return y}function b(N,M,w,C,y){if(N.visible===!1)return;if(N.layers.test(M.layers)&&(N.isMesh||N.isLine||N.isPoints)&&(N.castShadow||N.receiveShadow&&y===Ui)&&(!N.frustumCulled||n.intersectsObject(N))){N.modelViewMatrix.multiplyMatrices(w.matrixWorldInverse,N.matrixWorld);const R=t.update(N),q=N.material;if(Array.isArray(q)){const nt=R.groups;for(let j=0,ot=nt.length;j<ot;j++){const Y=nt[j],Et=q[Y.materialIndex];if(Et&&Et.visible){const Tt=S(N,Et,C,y);N.onBeforeShadow(i,N,M,w,R,Tt,Y),i.renderBufferDirect(w,null,R,Tt,N,Y),N.onAfterShadow(i,N,M,w,R,Tt,Y)}}}else if(q.visible){const nt=S(N,q,C,y);N.onBeforeShadow(i,N,M,w,R,nt,null),i.renderBufferDirect(w,null,R,nt,N,null),N.onAfterShadow(i,N,M,w,R,nt,null)}}const L=N.children;for(let R=0,q=L.length;R<q;R++)b(L[R],M,w,C,y)}function F(N){N.target.removeEventListener("dispose",F);for(const w in l){const C=l[w],y=N.target.uuid;y in C&&(C[y].dispose(),delete C[y])}}}const TM={[Qu]:th,[eh]:sh,[nh]:rh,[qr]:ih,[th]:Qu,[sh]:eh,[rh]:nh,[ih]:qr};function SM(i){function t(){let B=!1;const _t=new ge;let $=null;const et=new ge(0,0,0,0);return{setMask:function(pt){$!==pt&&!B&&(i.colorMask(pt,pt,pt,pt),$=pt)},setLocked:function(pt){B=pt},setClear:function(pt,mt,Kt,Ne,je){je===!0&&(pt*=Ne,mt*=Ne,Kt*=Ne),_t.set(pt,mt,Kt,Ne),et.equals(_t)===!1&&(i.clearColor(pt,mt,Kt,Ne),et.copy(_t))},reset:function(){B=!1,$=null,et.set(-1,0,0,0)}}}function e(){let B=!1,_t=!1,$=null,et=null,pt=null;return{setReversed:function(mt){_t=mt},setTest:function(mt){mt?bt(i.DEPTH_TEST):vt(i.DEPTH_TEST)},setMask:function(mt){$!==mt&&!B&&(i.depthMask(mt),$=mt)},setFunc:function(mt){if(_t&&(mt=TM[mt]),et!==mt){switch(mt){case Qu:i.depthFunc(i.NEVER);break;case th:i.depthFunc(i.ALWAYS);break;case eh:i.depthFunc(i.LESS);break;case qr:i.depthFunc(i.LEQUAL);break;case nh:i.depthFunc(i.EQUAL);break;case ih:i.depthFunc(i.GEQUAL);break;case sh:i.depthFunc(i.GREATER);break;case rh:i.depthFunc(i.NOTEQUAL);break;default:i.depthFunc(i.LEQUAL)}et=mt}},setLocked:function(mt){B=mt},setClear:function(mt){pt!==mt&&(i.clearDepth(mt),pt=mt)},reset:function(){B=!1,$=null,et=null,pt=null}}}function n(){let B=!1,_t=null,$=null,et=null,pt=null,mt=null,Kt=null,Ne=null,je=null;return{setTest:function(ae){B||(ae?bt(i.STENCIL_TEST):vt(i.STENCIL_TEST))},setMask:function(ae){_t!==ae&&!B&&(i.stencilMask(ae),_t=ae)},setFunc:function(ae,ze,Vn){($!==ae||et!==ze||pt!==Vn)&&(i.stencilFunc(ae,ze,Vn),$=ae,et=ze,pt=Vn)},setOp:function(ae,ze,Vn){(mt!==ae||Kt!==ze||Ne!==Vn)&&(i.stencilOp(ae,ze,Vn),mt=ae,Kt=ze,Ne=Vn)},setLocked:function(ae){B=ae},setClear:function(ae){je!==ae&&(i.clearStencil(ae),je=ae)},reset:function(){B=!1,_t=null,$=null,et=null,pt=null,mt=null,Kt=null,Ne=null,je=null}}}const s=new t,r=new e,o=new n,a=new WeakMap,c=new WeakMap;let l={},h={},d=new WeakMap,f=[],p=null,v=!1,x=null,m=null,_=null,A=null,S=null,b=null,F=null,N=new It(0,0,0),M=0,w=!1,C=null,y=null,E=null,L=null,R=null;const q=i.getParameter(i.MAX_COMBINED_TEXTURE_IMAGE_UNITS);let nt=!1,j=0;const ot=i.getParameter(i.VERSION);ot.indexOf("WebGL")!==-1?(j=parseFloat(/^WebGL (\d)/.exec(ot)[1]),nt=j>=1):ot.indexOf("OpenGL ES")!==-1&&(j=parseFloat(/^OpenGL ES (\d)/.exec(ot)[1]),nt=j>=2);let Y=null,Et={};const Tt=i.getParameter(i.SCISSOR_BOX),Ct=i.getParameter(i.VIEWPORT),$t=new ge().fromArray(Tt),Ht=new ge().fromArray(Ct);function J(B,_t,$,et){const pt=new Uint8Array(4),mt=i.createTexture();i.bindTexture(B,mt),i.texParameteri(B,i.TEXTURE_MIN_FILTER,i.NEAREST),i.texParameteri(B,i.TEXTURE_MAG_FILTER,i.NEAREST);for(let Kt=0;Kt<$;Kt++)B===i.TEXTURE_3D||B===i.TEXTURE_2D_ARRAY?i.texImage3D(_t,0,i.RGBA,1,1,et,0,i.RGBA,i.UNSIGNED_BYTE,pt):i.texImage2D(_t+Kt,0,i.RGBA,1,1,0,i.RGBA,i.UNSIGNED_BYTE,pt);return mt}const rt={};rt[i.TEXTURE_2D]=J(i.TEXTURE_2D,i.TEXTURE_2D,1),rt[i.TEXTURE_CUBE_MAP]=J(i.TEXTURE_CUBE_MAP,i.TEXTURE_CUBE_MAP_POSITIVE_X,6),rt[i.TEXTURE_2D_ARRAY]=J(i.TEXTURE_2D_ARRAY,i.TEXTURE_2D_ARRAY,1,1),rt[i.TEXTURE_3D]=J(i.TEXTURE_3D,i.TEXTURE_3D,1,1),s.setClear(0,0,0,1),r.setClear(1),o.setClear(0),bt(i.DEPTH_TEST),r.setFunc(qr),te(!1),re(Zf),bt(i.CULL_FACE),V(cs);function bt(B){l[B]!==!0&&(i.enable(B),l[B]=!0)}function vt(B){l[B]!==!1&&(i.disable(B),l[B]=!1)}function Xt(B,_t){return h[B]!==_t?(i.bindFramebuffer(B,_t),h[B]=_t,B===i.DRAW_FRAMEBUFFER&&(h[i.FRAMEBUFFER]=_t),B===i.FRAMEBUFFER&&(h[i.DRAW_FRAMEBUFFER]=_t),!0):!1}function Vt(B,_t){let $=f,et=!1;if(B){$=d.get(_t),$===void 0&&($=[],d.set(_t,$));const pt=B.textures;if($.length!==pt.length||$[0]!==i.COLOR_ATTACHMENT0){for(let mt=0,Kt=pt.length;mt<Kt;mt++)$[mt]=i.COLOR_ATTACHMENT0+mt;$.length=pt.length,et=!0}}else $[0]!==i.BACK&&($[0]=i.BACK,et=!0);et&&i.drawBuffers($)}function Qt(B){return p!==B?(i.useProgram(B),p=B,!0):!1}const ue={[Vs]:i.FUNC_ADD,[vy]:i.FUNC_SUBTRACT,[yy]:i.FUNC_REVERSE_SUBTRACT};ue[xy]=i.MIN,ue[Ey]=i.MAX;const ne={[Ty]:i.ZERO,[Sy]:i.ONE,[Ay]:i.SRC_COLOR,[Ju]:i.SRC_ALPHA,[Cy]:i.SRC_ALPHA_SATURATE,[Ry]:i.DST_COLOR,[wy]:i.DST_ALPHA,[My]:i.ONE_MINUS_SRC_COLOR,[Zu]:i.ONE_MINUS_SRC_ALPHA,[Iy]:i.ONE_MINUS_DST_COLOR,[by]:i.ONE_MINUS_DST_ALPHA,[Py]:i.CONSTANT_COLOR,[Dy]:i.ONE_MINUS_CONSTANT_COLOR,[Ly]:i.CONSTANT_ALPHA,[Ny]:i.ONE_MINUS_CONSTANT_ALPHA};function V(B,_t,$,et,pt,mt,Kt,Ne,je,ae){if(B===cs){v===!0&&(vt(i.BLEND),v=!1);return}if(v===!1&&(bt(i.BLEND),v=!0),B!==_y){if(B!==x||ae!==w){if((m!==Vs||S!==Vs)&&(i.blendEquation(i.FUNC_ADD),m=Vs,S=Vs),ae)switch(B){case Br:i.blendFuncSeparate(i.ONE,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case Qf:i.blendFunc(i.ONE,i.ONE);break;case tp:i.blendFuncSeparate(i.ZERO,i.ONE_MINUS_SRC_COLOR,i.ZERO,i.ONE);break;case ep:i.blendFuncSeparate(i.ZERO,i.SRC_COLOR,i.ZERO,i.SRC_ALPHA);break;default:console.error("THREE.WebGLState: Invalid blending: ",B);break}else switch(B){case Br:i.blendFuncSeparate(i.SRC_ALPHA,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case Qf:i.blendFunc(i.SRC_ALPHA,i.ONE);break;case tp:i.blendFuncSeparate(i.ZERO,i.ONE_MINUS_SRC_COLOR,i.ZERO,i.ONE);break;case ep:i.blendFunc(i.ZERO,i.SRC_COLOR);break;default:console.error("THREE.WebGLState: Invalid blending: ",B);break}_=null,A=null,b=null,F=null,N.set(0,0,0),M=0,x=B,w=ae}return}pt=pt||_t,mt=mt||$,Kt=Kt||et,(_t!==m||pt!==S)&&(i.blendEquationSeparate(ue[_t],ue[pt]),m=_t,S=pt),($!==_||et!==A||mt!==b||Kt!==F)&&(i.blendFuncSeparate(ne[$],ne[et],ne[mt],ne[Kt]),_=$,A=et,b=mt,F=Kt),(Ne.equals(N)===!1||je!==M)&&(i.blendColor(Ne.r,Ne.g,Ne.b,je),N.copy(Ne),M=je),x=B,w=!1}function cn(B,_t){B.side===ei?vt(i.CULL_FACE):bt(i.CULL_FACE);let $=B.side===Dn;_t&&($=!$),te($),B.blending===Br&&B.transparent===!1?V(cs):V(B.blending,B.blendEquation,B.blendSrc,B.blendDst,B.blendEquationAlpha,B.blendSrcAlpha,B.blendDstAlpha,B.blendColor,B.blendAlpha,B.premultipliedAlpha),r.setFunc(B.depthFunc),r.setTest(B.depthTest),r.setMask(B.depthWrite),s.setMask(B.colorWrite);const et=B.stencilWrite;o.setTest(et),et&&(o.setMask(B.stencilWriteMask),o.setFunc(B.stencilFunc,B.stencilRef,B.stencilFuncMask),o.setOp(B.stencilFail,B.stencilZFail,B.stencilZPass)),Te(B.polygonOffset,B.polygonOffsetFactor,B.polygonOffsetUnits),B.alphaToCoverage===!0?bt(i.SAMPLE_ALPHA_TO_COVERAGE):vt(i.SAMPLE_ALPHA_TO_COVERAGE)}function te(B){C!==B&&(B?i.frontFace(i.CW):i.frontFace(i.CCW),C=B)}function re(B){B!==py?(bt(i.CULL_FACE),B!==y&&(B===Zf?i.cullFace(i.BACK):B===my?i.cullFace(i.FRONT):i.cullFace(i.FRONT_AND_BACK))):vt(i.CULL_FACE),y=B}function kt(B){B!==E&&(nt&&i.lineWidth(B),E=B)}function Te(B,_t,$){B?(bt(i.POLYGON_OFFSET_FILL),(L!==_t||R!==$)&&(i.polygonOffset(_t,$),L=_t,R=$)):vt(i.POLYGON_OFFSET_FILL)}function zt(B){B?bt(i.SCISSOR_TEST):vt(i.SCISSOR_TEST)}function U(B){B===void 0&&(B=i.TEXTURE0+q-1),Y!==B&&(i.activeTexture(B),Y=B)}function I(B,_t,$){$===void 0&&(Y===null?$=i.TEXTURE0+q-1:$=Y);let et=Et[$];et===void 0&&(et={type:void 0,texture:void 0},Et[$]=et),(et.type!==B||et.texture!==_t)&&(Y!==$&&(i.activeTexture($),Y=$),i.bindTexture(B,_t||rt[B]),et.type=B,et.texture=_t)}function G(){const B=Et[Y];B!==void 0&&B.type!==void 0&&(i.bindTexture(B.type,null),B.type=void 0,B.texture=void 0)}function Z(){try{i.compressedTexImage2D.apply(i,arguments)}catch(B){console.error("THREE.WebGLState:",B)}}function st(){try{i.compressedTexImage3D.apply(i,arguments)}catch(B){console.error("THREE.WebGLState:",B)}}function Q(){try{i.texSubImage2D.apply(i,arguments)}catch(B){console.error("THREE.WebGLState:",B)}}function ft(){try{i.texSubImage3D.apply(i,arguments)}catch(B){console.error("THREE.WebGLState:",B)}}function at(){try{i.compressedTexSubImage2D.apply(i,arguments)}catch(B){console.error("THREE.WebGLState:",B)}}function yt(){try{i.compressedTexSubImage3D.apply(i,arguments)}catch(B){console.error("THREE.WebGLState:",B)}}function oe(){try{i.texStorage2D.apply(i,arguments)}catch(B){console.error("THREE.WebGLState:",B)}}function ct(){try{i.texStorage3D.apply(i,arguments)}catch(B){console.error("THREE.WebGLState:",B)}}function Mt(){try{i.texImage2D.apply(i,arguments)}catch(B){console.error("THREE.WebGLState:",B)}}function Ut(){try{i.texImage3D.apply(i,arguments)}catch(B){console.error("THREE.WebGLState:",B)}}function Bt(B){$t.equals(B)===!1&&(i.scissor(B.x,B.y,B.z,B.w),$t.copy(B))}function St(B){Ht.equals(B)===!1&&(i.viewport(B.x,B.y,B.z,B.w),Ht.copy(B))}function ee(B,_t){let $=c.get(_t);$===void 0&&($=new WeakMap,c.set(_t,$));let et=$.get(B);et===void 0&&(et=i.getUniformBlockIndex(_t,B.name),$.set(B,et))}function qt(B,_t){const et=c.get(_t).get(B);a.get(_t)!==et&&(i.uniformBlockBinding(_t,et,B.__bindingPointIndex),a.set(_t,et))}function Ee(){i.disable(i.BLEND),i.disable(i.CULL_FACE),i.disable(i.DEPTH_TEST),i.disable(i.POLYGON_OFFSET_FILL),i.disable(i.SCISSOR_TEST),i.disable(i.STENCIL_TEST),i.disable(i.SAMPLE_ALPHA_TO_COVERAGE),i.blendEquation(i.FUNC_ADD),i.blendFunc(i.ONE,i.ZERO),i.blendFuncSeparate(i.ONE,i.ZERO,i.ONE,i.ZERO),i.blendColor(0,0,0,0),i.colorMask(!0,!0,!0,!0),i.clearColor(0,0,0,0),i.depthMask(!0),i.depthFunc(i.LESS),i.clearDepth(1),i.stencilMask(4294967295),i.stencilFunc(i.ALWAYS,0,4294967295),i.stencilOp(i.KEEP,i.KEEP,i.KEEP),i.clearStencil(0),i.cullFace(i.BACK),i.frontFace(i.CCW),i.polygonOffset(0,0),i.activeTexture(i.TEXTURE0),i.bindFramebuffer(i.FRAMEBUFFER,null),i.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),i.bindFramebuffer(i.READ_FRAMEBUFFER,null),i.useProgram(null),i.lineWidth(1),i.scissor(0,0,i.canvas.width,i.canvas.height),i.viewport(0,0,i.canvas.width,i.canvas.height),l={},Y=null,Et={},h={},d=new WeakMap,f=[],p=null,v=!1,x=null,m=null,_=null,A=null,S=null,b=null,F=null,N=new It(0,0,0),M=0,w=!1,C=null,y=null,E=null,L=null,R=null,$t.set(0,0,i.canvas.width,i.canvas.height),Ht.set(0,0,i.canvas.width,i.canvas.height),s.reset(),r.reset(),o.reset()}return{buffers:{color:s,depth:r,stencil:o},enable:bt,disable:vt,bindFramebuffer:Xt,drawBuffers:Vt,useProgram:Qt,setBlending:V,setMaterial:cn,setFlipSided:te,setCullFace:re,setLineWidth:kt,setPolygonOffset:Te,setScissorTest:zt,activeTexture:U,bindTexture:I,unbindTexture:G,compressedTexImage2D:Z,compressedTexImage3D:st,texImage2D:Mt,texImage3D:Ut,updateUBOMapping:ee,uniformBlockBinding:qt,texStorage2D:oe,texStorage3D:ct,texSubImage2D:Q,texSubImage3D:ft,compressedTexSubImage2D:at,compressedTexSubImage3D:yt,scissor:Bt,viewport:St,reset:Ee}}function qp(i,t,e,n){const s=AM(n);switch(e){case e_:return i*t;case i_:return i*t;case s_:return i*t*2;case yd:return i*t/s.components*s.byteLength;case xd:return i*t/s.components*s.byteLength;case r_:return i*t*2/s.components*s.byteLength;case Ed:return i*t*2/s.components*s.byteLength;case n_:return i*t*3/s.components*s.byteLength;case Xn:return i*t*4/s.components*s.byteLength;case Td:return i*t*4/s.components*s.byteLength;case Uc:case Oc:return Math.floor((i+3)/4)*Math.floor((t+3)/4)*8;case Fc:case Vc:return Math.floor((i+3)/4)*Math.floor((t+3)/4)*16;case lh:case hh:return Math.max(i,16)*Math.max(t,8)/4;case ch:case uh:return Math.max(i,8)*Math.max(t,8)/2;case dh:case fh:return Math.floor((i+3)/4)*Math.floor((t+3)/4)*8;case ph:return Math.floor((i+3)/4)*Math.floor((t+3)/4)*16;case mh:return Math.floor((i+3)/4)*Math.floor((t+3)/4)*16;case gh:return Math.floor((i+4)/5)*Math.floor((t+3)/4)*16;case _h:return Math.floor((i+4)/5)*Math.floor((t+4)/5)*16;case vh:return Math.floor((i+5)/6)*Math.floor((t+4)/5)*16;case yh:return Math.floor((i+5)/6)*Math.floor((t+5)/6)*16;case xh:return Math.floor((i+7)/8)*Math.floor((t+4)/5)*16;case Eh:return Math.floor((i+7)/8)*Math.floor((t+5)/6)*16;case Th:return Math.floor((i+7)/8)*Math.floor((t+7)/8)*16;case Sh:return Math.floor((i+9)/10)*Math.floor((t+4)/5)*16;case Ah:return Math.floor((i+9)/10)*Math.floor((t+5)/6)*16;case Mh:return Math.floor((i+9)/10)*Math.floor((t+7)/8)*16;case wh:return Math.floor((i+9)/10)*Math.floor((t+9)/10)*16;case bh:return Math.floor((i+11)/12)*Math.floor((t+9)/10)*16;case Rh:return Math.floor((i+11)/12)*Math.floor((t+11)/12)*16;case Bc:case Ih:case Ch:return Math.ceil(i/4)*Math.ceil(t/4)*16;case o_:case Ph:return Math.ceil(i/4)*Math.ceil(t/4)*8;case Dh:case Lh:return Math.ceil(i/4)*Math.ceil(t/4)*16}throw new Error(`Unable to determine texture byte length for ${e} format.`)}function AM(i){switch(i){case ki:case Zg:return{byteLength:1,components:1};case la:case Qg:case Ia:return{byteLength:2,components:1};case _d:case vd:return{byteLength:2,components:4};case $s:case gd:case si:return{byteLength:4,components:1};case t_:return{byteLength:4,components:3}}throw new Error(`Unknown texture type ${i}.`)}function MM(i,t,e,n,s,r,o){const a=t.has("WEBGL_multisampled_render_to_texture")?t.get("WEBGL_multisampled_render_to_texture"):null,c=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),l=new dt,h=new WeakMap;let d;const f=new WeakMap;let p=!1;try{p=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function v(U,I){return p?new OffscreenCanvas(U,I):da("canvas")}function x(U,I,G){let Z=1;const st=zt(U);if((st.width>G||st.height>G)&&(Z=G/Math.max(st.width,st.height)),Z<1)if(typeof HTMLImageElement<"u"&&U instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&U instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&U instanceof ImageBitmap||typeof VideoFrame<"u"&&U instanceof VideoFrame){const Q=Math.floor(Z*st.width),ft=Math.floor(Z*st.height);d===void 0&&(d=v(Q,ft));const at=I?v(Q,ft):d;return at.width=Q,at.height=ft,at.getContext("2d").drawImage(U,0,0,Q,ft),console.warn("THREE.WebGLRenderer: Texture has been resized from ("+st.width+"x"+st.height+") to ("+Q+"x"+ft+")."),at}else return"data"in U&&console.warn("THREE.WebGLRenderer: Image in DataTexture is too big ("+st.width+"x"+st.height+")."),U;return U}function m(U){return U.generateMipmaps&&U.minFilter!==Rn&&U.minFilter!==Fn}function _(U){i.generateMipmap(U)}function A(U,I,G,Z,st=!1){if(U!==null){if(i[U]!==void 0)return i[U];console.warn("THREE.WebGLRenderer: Attempt to use non-existing WebGL internal format '"+U+"'")}let Q=I;if(I===i.RED&&(G===i.FLOAT&&(Q=i.R32F),G===i.HALF_FLOAT&&(Q=i.R16F),G===i.UNSIGNED_BYTE&&(Q=i.R8)),I===i.RED_INTEGER&&(G===i.UNSIGNED_BYTE&&(Q=i.R8UI),G===i.UNSIGNED_SHORT&&(Q=i.R16UI),G===i.UNSIGNED_INT&&(Q=i.R32UI),G===i.BYTE&&(Q=i.R8I),G===i.SHORT&&(Q=i.R16I),G===i.INT&&(Q=i.R32I)),I===i.RG&&(G===i.FLOAT&&(Q=i.RG32F),G===i.HALF_FLOAT&&(Q=i.RG16F),G===i.UNSIGNED_BYTE&&(Q=i.RG8)),I===i.RG_INTEGER&&(G===i.UNSIGNED_BYTE&&(Q=i.RG8UI),G===i.UNSIGNED_SHORT&&(Q=i.RG16UI),G===i.UNSIGNED_INT&&(Q=i.RG32UI),G===i.BYTE&&(Q=i.RG8I),G===i.SHORT&&(Q=i.RG16I),G===i.INT&&(Q=i.RG32I)),I===i.RGB_INTEGER&&(G===i.UNSIGNED_BYTE&&(Q=i.RGB8UI),G===i.UNSIGNED_SHORT&&(Q=i.RGB16UI),G===i.UNSIGNED_INT&&(Q=i.RGB32UI),G===i.BYTE&&(Q=i.RGB8I),G===i.SHORT&&(Q=i.RGB16I),G===i.INT&&(Q=i.RGB32I)),I===i.RGBA_INTEGER&&(G===i.UNSIGNED_BYTE&&(Q=i.RGBA8UI),G===i.UNSIGNED_SHORT&&(Q=i.RGBA16UI),G===i.UNSIGNED_INT&&(Q=i.RGBA32UI),G===i.BYTE&&(Q=i.RGBA8I),G===i.SHORT&&(Q=i.RGBA16I),G===i.INT&&(Q=i.RGBA32I)),I===i.RGB&&G===i.UNSIGNED_INT_5_9_9_9_REV&&(Q=i.RGB9_E5),I===i.RGBA){const ft=st?Zc:me.getTransfer(Z);G===i.FLOAT&&(Q=i.RGBA32F),G===i.HALF_FLOAT&&(Q=i.RGBA16F),G===i.UNSIGNED_BYTE&&(Q=ft===Ie?i.SRGB8_ALPHA8:i.RGBA8),G===i.UNSIGNED_SHORT_4_4_4_4&&(Q=i.RGBA4),G===i.UNSIGNED_SHORT_5_5_5_1&&(Q=i.RGB5_A1)}return(Q===i.R16F||Q===i.R32F||Q===i.RG16F||Q===i.RG32F||Q===i.RGBA16F||Q===i.RGBA32F)&&t.get("EXT_color_buffer_float"),Q}function S(U,I){let G;return U?I===null||I===$s||I===$r?G=i.DEPTH24_STENCIL8:I===si?G=i.DEPTH32F_STENCIL8:I===la&&(G=i.DEPTH24_STENCIL8,console.warn("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):I===null||I===$s||I===$r?G=i.DEPTH_COMPONENT24:I===si?G=i.DEPTH_COMPONENT32F:I===la&&(G=i.DEPTH_COMPONENT16),G}function b(U,I){return m(U)===!0||U.isFramebufferTexture&&U.minFilter!==Rn&&U.minFilter!==Fn?Math.log2(Math.max(I.width,I.height))+1:U.mipmaps!==void 0&&U.mipmaps.length>0?U.mipmaps.length:U.isCompressedTexture&&Array.isArray(U.image)?I.mipmaps.length:1}function F(U){const I=U.target;I.removeEventListener("dispose",F),M(I),I.isVideoTexture&&h.delete(I)}function N(U){const I=U.target;I.removeEventListener("dispose",N),C(I)}function M(U){const I=n.get(U);if(I.__webglInit===void 0)return;const G=U.source,Z=f.get(G);if(Z){const st=Z[I.__cacheKey];st.usedTimes--,st.usedTimes===0&&w(U),Object.keys(Z).length===0&&f.delete(G)}n.remove(U)}function w(U){const I=n.get(U);i.deleteTexture(I.__webglTexture);const G=U.source,Z=f.get(G);delete Z[I.__cacheKey],o.memory.textures--}function C(U){const I=n.get(U);if(U.depthTexture&&U.depthTexture.dispose(),U.isWebGLCubeRenderTarget)for(let Z=0;Z<6;Z++){if(Array.isArray(I.__webglFramebuffer[Z]))for(let st=0;st<I.__webglFramebuffer[Z].length;st++)i.deleteFramebuffer(I.__webglFramebuffer[Z][st]);else i.deleteFramebuffer(I.__webglFramebuffer[Z]);I.__webglDepthbuffer&&i.deleteRenderbuffer(I.__webglDepthbuffer[Z])}else{if(Array.isArray(I.__webglFramebuffer))for(let Z=0;Z<I.__webglFramebuffer.length;Z++)i.deleteFramebuffer(I.__webglFramebuffer[Z]);else i.deleteFramebuffer(I.__webglFramebuffer);if(I.__webglDepthbuffer&&i.deleteRenderbuffer(I.__webglDepthbuffer),I.__webglMultisampledFramebuffer&&i.deleteFramebuffer(I.__webglMultisampledFramebuffer),I.__webglColorRenderbuffer)for(let Z=0;Z<I.__webglColorRenderbuffer.length;Z++)I.__webglColorRenderbuffer[Z]&&i.deleteRenderbuffer(I.__webglColorRenderbuffer[Z]);I.__webglDepthRenderbuffer&&i.deleteRenderbuffer(I.__webglDepthRenderbuffer)}const G=U.textures;for(let Z=0,st=G.length;Z<st;Z++){const Q=n.get(G[Z]);Q.__webglTexture&&(i.deleteTexture(Q.__webglTexture),o.memory.textures--),n.remove(G[Z])}n.remove(U)}let y=0;function E(){y=0}function L(){const U=y;return U>=s.maxTextures&&console.warn("THREE.WebGLTextures: Trying to use "+U+" texture units while this GPU supports only "+s.maxTextures),y+=1,U}function R(U){const I=[];return I.push(U.wrapS),I.push(U.wrapT),I.push(U.wrapR||0),I.push(U.magFilter),I.push(U.minFilter),I.push(U.anisotropy),I.push(U.internalFormat),I.push(U.format),I.push(U.type),I.push(U.generateMipmaps),I.push(U.premultiplyAlpha),I.push(U.flipY),I.push(U.unpackAlignment),I.push(U.colorSpace),I.join()}function q(U,I){const G=n.get(U);if(U.isVideoTexture&&kt(U),U.isRenderTargetTexture===!1&&U.version>0&&G.__version!==U.version){const Z=U.image;if(Z===null)console.warn("THREE.WebGLRenderer: Texture marked for update but no image data found.");else if(Z.complete===!1)console.warn("THREE.WebGLRenderer: Texture marked for update but image is incomplete");else{Ht(G,U,I);return}}e.bindTexture(i.TEXTURE_2D,G.__webglTexture,i.TEXTURE0+I)}function nt(U,I){const G=n.get(U);if(U.version>0&&G.__version!==U.version){Ht(G,U,I);return}e.bindTexture(i.TEXTURE_2D_ARRAY,G.__webglTexture,i.TEXTURE0+I)}function j(U,I){const G=n.get(U);if(U.version>0&&G.__version!==U.version){Ht(G,U,I);return}e.bindTexture(i.TEXTURE_3D,G.__webglTexture,i.TEXTURE0+I)}function ot(U,I){const G=n.get(U);if(U.version>0&&G.__version!==U.version){J(G,U,I);return}e.bindTexture(i.TEXTURE_CUBE_MAP,G.__webglTexture,i.TEXTURE0+I)}const Y={[Ks]:i.REPEAT,[ss]:i.CLAMP_TO_EDGE,[Yc]:i.MIRRORED_REPEAT},Et={[Rn]:i.NEAREST,[Jg]:i.NEAREST_MIPMAP_NEAREST,[Wo]:i.NEAREST_MIPMAP_LINEAR,[Fn]:i.LINEAR,[Nc]:i.LINEAR_MIPMAP_NEAREST,[Fi]:i.LINEAR_MIPMAP_LINEAR},Tt={[Qy]:i.NEVER,[rx]:i.ALWAYS,[tx]:i.LESS,[c_]:i.LEQUAL,[ex]:i.EQUAL,[sx]:i.GEQUAL,[nx]:i.GREATER,[ix]:i.NOTEQUAL};function Ct(U,I){if(I.type===si&&t.has("OES_texture_float_linear")===!1&&(I.magFilter===Fn||I.magFilter===Nc||I.magFilter===Wo||I.magFilter===Fi||I.minFilter===Fn||I.minFilter===Nc||I.minFilter===Wo||I.minFilter===Fi)&&console.warn("THREE.WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),i.texParameteri(U,i.TEXTURE_WRAP_S,Y[I.wrapS]),i.texParameteri(U,i.TEXTURE_WRAP_T,Y[I.wrapT]),(U===i.TEXTURE_3D||U===i.TEXTURE_2D_ARRAY)&&i.texParameteri(U,i.TEXTURE_WRAP_R,Y[I.wrapR]),i.texParameteri(U,i.TEXTURE_MAG_FILTER,Et[I.magFilter]),i.texParameteri(U,i.TEXTURE_MIN_FILTER,Et[I.minFilter]),I.compareFunction&&(i.texParameteri(U,i.TEXTURE_COMPARE_MODE,i.COMPARE_REF_TO_TEXTURE),i.texParameteri(U,i.TEXTURE_COMPARE_FUNC,Tt[I.compareFunction])),t.has("EXT_texture_filter_anisotropic")===!0){if(I.magFilter===Rn||I.minFilter!==Wo&&I.minFilter!==Fi||I.type===si&&t.has("OES_texture_float_linear")===!1)return;if(I.anisotropy>1||n.get(I).__currentAnisotropy){const G=t.get("EXT_texture_filter_anisotropic");i.texParameterf(U,G.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(I.anisotropy,s.getMaxAnisotropy())),n.get(I).__currentAnisotropy=I.anisotropy}}}function $t(U,I){let G=!1;U.__webglInit===void 0&&(U.__webglInit=!0,I.addEventListener("dispose",F));const Z=I.source;let st=f.get(Z);st===void 0&&(st={},f.set(Z,st));const Q=R(I);if(Q!==U.__cacheKey){st[Q]===void 0&&(st[Q]={texture:i.createTexture(),usedTimes:0},o.memory.textures++,G=!0),st[Q].usedTimes++;const ft=st[U.__cacheKey];ft!==void 0&&(st[U.__cacheKey].usedTimes--,ft.usedTimes===0&&w(I)),U.__cacheKey=Q,U.__webglTexture=st[Q].texture}return G}function Ht(U,I,G){let Z=i.TEXTURE_2D;(I.isDataArrayTexture||I.isCompressedArrayTexture)&&(Z=i.TEXTURE_2D_ARRAY),I.isData3DTexture&&(Z=i.TEXTURE_3D);const st=$t(U,I),Q=I.source;e.bindTexture(Z,U.__webglTexture,i.TEXTURE0+G);const ft=n.get(Q);if(Q.version!==ft.__version||st===!0){e.activeTexture(i.TEXTURE0+G);const at=me.getPrimaries(me.workingColorSpace),yt=I.colorSpace===ns?null:me.getPrimaries(I.colorSpace),oe=I.colorSpace===ns||at===yt?i.NONE:i.BROWSER_DEFAULT_WEBGL;i.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,I.flipY),i.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,I.premultiplyAlpha),i.pixelStorei(i.UNPACK_ALIGNMENT,I.unpackAlignment),i.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,oe);let ct=x(I.image,!1,s.maxTextureSize);ct=Te(I,ct);const Mt=r.convert(I.format,I.colorSpace),Ut=r.convert(I.type);let Bt=A(I.internalFormat,Mt,Ut,I.colorSpace,I.isVideoTexture);Ct(Z,I);let St;const ee=I.mipmaps,qt=I.isVideoTexture!==!0,Ee=ft.__version===void 0||st===!0,B=Q.dataReady,_t=b(I,ct);if(I.isDepthTexture)Bt=S(I.format===Yr,I.type),Ee&&(qt?e.texStorage2D(i.TEXTURE_2D,1,Bt,ct.width,ct.height):e.texImage2D(i.TEXTURE_2D,0,Bt,ct.width,ct.height,0,Mt,Ut,null));else if(I.isDataTexture)if(ee.length>0){qt&&Ee&&e.texStorage2D(i.TEXTURE_2D,_t,Bt,ee[0].width,ee[0].height);for(let $=0,et=ee.length;$<et;$++)St=ee[$],qt?B&&e.texSubImage2D(i.TEXTURE_2D,$,0,0,St.width,St.height,Mt,Ut,St.data):e.texImage2D(i.TEXTURE_2D,$,Bt,St.width,St.height,0,Mt,Ut,St.data);I.generateMipmaps=!1}else qt?(Ee&&e.texStorage2D(i.TEXTURE_2D,_t,Bt,ct.width,ct.height),B&&e.texSubImage2D(i.TEXTURE_2D,0,0,0,ct.width,ct.height,Mt,Ut,ct.data)):e.texImage2D(i.TEXTURE_2D,0,Bt,ct.width,ct.height,0,Mt,Ut,ct.data);else if(I.isCompressedTexture)if(I.isCompressedArrayTexture){qt&&Ee&&e.texStorage3D(i.TEXTURE_2D_ARRAY,_t,Bt,ee[0].width,ee[0].height,ct.depth);for(let $=0,et=ee.length;$<et;$++)if(St=ee[$],I.format!==Xn)if(Mt!==null)if(qt){if(B)if(I.layerUpdates.size>0){const pt=qp(St.width,St.height,I.format,I.type);for(const mt of I.layerUpdates){const Kt=St.data.subarray(mt*pt/St.data.BYTES_PER_ELEMENT,(mt+1)*pt/St.data.BYTES_PER_ELEMENT);e.compressedTexSubImage3D(i.TEXTURE_2D_ARRAY,$,0,0,mt,St.width,St.height,1,Mt,Kt,0,0)}I.clearLayerUpdates()}else e.compressedTexSubImage3D(i.TEXTURE_2D_ARRAY,$,0,0,0,St.width,St.height,ct.depth,Mt,St.data,0,0)}else e.compressedTexImage3D(i.TEXTURE_2D_ARRAY,$,Bt,St.width,St.height,ct.depth,0,St.data,0,0);else console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else qt?B&&e.texSubImage3D(i.TEXTURE_2D_ARRAY,$,0,0,0,St.width,St.height,ct.depth,Mt,Ut,St.data):e.texImage3D(i.TEXTURE_2D_ARRAY,$,Bt,St.width,St.height,ct.depth,0,Mt,Ut,St.data)}else{qt&&Ee&&e.texStorage2D(i.TEXTURE_2D,_t,Bt,ee[0].width,ee[0].height);for(let $=0,et=ee.length;$<et;$++)St=ee[$],I.format!==Xn?Mt!==null?qt?B&&e.compressedTexSubImage2D(i.TEXTURE_2D,$,0,0,St.width,St.height,Mt,St.data):e.compressedTexImage2D(i.TEXTURE_2D,$,Bt,St.width,St.height,0,St.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):qt?B&&e.texSubImage2D(i.TEXTURE_2D,$,0,0,St.width,St.height,Mt,Ut,St.data):e.texImage2D(i.TEXTURE_2D,$,Bt,St.width,St.height,0,Mt,Ut,St.data)}else if(I.isDataArrayTexture)if(qt){if(Ee&&e.texStorage3D(i.TEXTURE_2D_ARRAY,_t,Bt,ct.width,ct.height,ct.depth),B)if(I.layerUpdates.size>0){const $=qp(ct.width,ct.height,I.format,I.type);for(const et of I.layerUpdates){const pt=ct.data.subarray(et*$/ct.data.BYTES_PER_ELEMENT,(et+1)*$/ct.data.BYTES_PER_ELEMENT);e.texSubImage3D(i.TEXTURE_2D_ARRAY,0,0,0,et,ct.width,ct.height,1,Mt,Ut,pt)}I.clearLayerUpdates()}else e.texSubImage3D(i.TEXTURE_2D_ARRAY,0,0,0,0,ct.width,ct.height,ct.depth,Mt,Ut,ct.data)}else e.texImage3D(i.TEXTURE_2D_ARRAY,0,Bt,ct.width,ct.height,ct.depth,0,Mt,Ut,ct.data);else if(I.isData3DTexture)qt?(Ee&&e.texStorage3D(i.TEXTURE_3D,_t,Bt,ct.width,ct.height,ct.depth),B&&e.texSubImage3D(i.TEXTURE_3D,0,0,0,0,ct.width,ct.height,ct.depth,Mt,Ut,ct.data)):e.texImage3D(i.TEXTURE_3D,0,Bt,ct.width,ct.height,ct.depth,0,Mt,Ut,ct.data);else if(I.isFramebufferTexture){if(Ee)if(qt)e.texStorage2D(i.TEXTURE_2D,_t,Bt,ct.width,ct.height);else{let $=ct.width,et=ct.height;for(let pt=0;pt<_t;pt++)e.texImage2D(i.TEXTURE_2D,pt,Bt,$,et,0,Mt,Ut,null),$>>=1,et>>=1}}else if(ee.length>0){if(qt&&Ee){const $=zt(ee[0]);e.texStorage2D(i.TEXTURE_2D,_t,Bt,$.width,$.height)}for(let $=0,et=ee.length;$<et;$++)St=ee[$],qt?B&&e.texSubImage2D(i.TEXTURE_2D,$,0,0,Mt,Ut,St):e.texImage2D(i.TEXTURE_2D,$,Bt,Mt,Ut,St);I.generateMipmaps=!1}else if(qt){if(Ee){const $=zt(ct);e.texStorage2D(i.TEXTURE_2D,_t,Bt,$.width,$.height)}B&&e.texSubImage2D(i.TEXTURE_2D,0,0,0,Mt,Ut,ct)}else e.texImage2D(i.TEXTURE_2D,0,Bt,Mt,Ut,ct);m(I)&&_(Z),ft.__version=Q.version,I.onUpdate&&I.onUpdate(I)}U.__version=I.version}function J(U,I,G){if(I.image.length!==6)return;const Z=$t(U,I),st=I.source;e.bindTexture(i.TEXTURE_CUBE_MAP,U.__webglTexture,i.TEXTURE0+G);const Q=n.get(st);if(st.version!==Q.__version||Z===!0){e.activeTexture(i.TEXTURE0+G);const ft=me.getPrimaries(me.workingColorSpace),at=I.colorSpace===ns?null:me.getPrimaries(I.colorSpace),yt=I.colorSpace===ns||ft===at?i.NONE:i.BROWSER_DEFAULT_WEBGL;i.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,I.flipY),i.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,I.premultiplyAlpha),i.pixelStorei(i.UNPACK_ALIGNMENT,I.unpackAlignment),i.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,yt);const oe=I.isCompressedTexture||I.image[0].isCompressedTexture,ct=I.image[0]&&I.image[0].isDataTexture,Mt=[];for(let et=0;et<6;et++)!oe&&!ct?Mt[et]=x(I.image[et],!0,s.maxCubemapSize):Mt[et]=ct?I.image[et].image:I.image[et],Mt[et]=Te(I,Mt[et]);const Ut=Mt[0],Bt=r.convert(I.format,I.colorSpace),St=r.convert(I.type),ee=A(I.internalFormat,Bt,St,I.colorSpace),qt=I.isVideoTexture!==!0,Ee=Q.__version===void 0||Z===!0,B=st.dataReady;let _t=b(I,Ut);Ct(i.TEXTURE_CUBE_MAP,I);let $;if(oe){qt&&Ee&&e.texStorage2D(i.TEXTURE_CUBE_MAP,_t,ee,Ut.width,Ut.height);for(let et=0;et<6;et++){$=Mt[et].mipmaps;for(let pt=0;pt<$.length;pt++){const mt=$[pt];I.format!==Xn?Bt!==null?qt?B&&e.compressedTexSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+et,pt,0,0,mt.width,mt.height,Bt,mt.data):e.compressedTexImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+et,pt,ee,mt.width,mt.height,0,mt.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):qt?B&&e.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+et,pt,0,0,mt.width,mt.height,Bt,St,mt.data):e.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+et,pt,ee,mt.width,mt.height,0,Bt,St,mt.data)}}}else{if($=I.mipmaps,qt&&Ee){$.length>0&&_t++;const et=zt(Mt[0]);e.texStorage2D(i.TEXTURE_CUBE_MAP,_t,ee,et.width,et.height)}for(let et=0;et<6;et++)if(ct){qt?B&&e.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+et,0,0,0,Mt[et].width,Mt[et].height,Bt,St,Mt[et].data):e.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+et,0,ee,Mt[et].width,Mt[et].height,0,Bt,St,Mt[et].data);for(let pt=0;pt<$.length;pt++){const Kt=$[pt].image[et].image;qt?B&&e.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+et,pt+1,0,0,Kt.width,Kt.height,Bt,St,Kt.data):e.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+et,pt+1,ee,Kt.width,Kt.height,0,Bt,St,Kt.data)}}else{qt?B&&e.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+et,0,0,0,Bt,St,Mt[et]):e.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+et,0,ee,Bt,St,Mt[et]);for(let pt=0;pt<$.length;pt++){const mt=$[pt];qt?B&&e.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+et,pt+1,0,0,Bt,St,mt.image[et]):e.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+et,pt+1,ee,Bt,St,mt.image[et])}}}m(I)&&_(i.TEXTURE_CUBE_MAP),Q.__version=st.version,I.onUpdate&&I.onUpdate(I)}U.__version=I.version}function rt(U,I,G,Z,st,Q){const ft=r.convert(G.format,G.colorSpace),at=r.convert(G.type),yt=A(G.internalFormat,ft,at,G.colorSpace);if(!n.get(I).__hasExternalTextures){const ct=Math.max(1,I.width>>Q),Mt=Math.max(1,I.height>>Q);st===i.TEXTURE_3D||st===i.TEXTURE_2D_ARRAY?e.texImage3D(st,Q,yt,ct,Mt,I.depth,0,ft,at,null):e.texImage2D(st,Q,yt,ct,Mt,0,ft,at,null)}e.bindFramebuffer(i.FRAMEBUFFER,U),re(I)?a.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,Z,st,n.get(G).__webglTexture,0,te(I)):(st===i.TEXTURE_2D||st>=i.TEXTURE_CUBE_MAP_POSITIVE_X&&st<=i.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&i.framebufferTexture2D(i.FRAMEBUFFER,Z,st,n.get(G).__webglTexture,Q),e.bindFramebuffer(i.FRAMEBUFFER,null)}function bt(U,I,G){if(i.bindRenderbuffer(i.RENDERBUFFER,U),I.depthBuffer){const Z=I.depthTexture,st=Z&&Z.isDepthTexture?Z.type:null,Q=S(I.stencilBuffer,st),ft=I.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,at=te(I);re(I)?a.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,at,Q,I.width,I.height):G?i.renderbufferStorageMultisample(i.RENDERBUFFER,at,Q,I.width,I.height):i.renderbufferStorage(i.RENDERBUFFER,Q,I.width,I.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,ft,i.RENDERBUFFER,U)}else{const Z=I.textures;for(let st=0;st<Z.length;st++){const Q=Z[st],ft=r.convert(Q.format,Q.colorSpace),at=r.convert(Q.type),yt=A(Q.internalFormat,ft,at,Q.colorSpace),oe=te(I);G&&re(I)===!1?i.renderbufferStorageMultisample(i.RENDERBUFFER,oe,yt,I.width,I.height):re(I)?a.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,oe,yt,I.width,I.height):i.renderbufferStorage(i.RENDERBUFFER,yt,I.width,I.height)}}i.bindRenderbuffer(i.RENDERBUFFER,null)}function vt(U,I){if(I&&I.isWebGLCubeRenderTarget)throw new Error("Depth Texture with cube render targets is not supported");if(e.bindFramebuffer(i.FRAMEBUFFER,U),!(I.depthTexture&&I.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");(!n.get(I.depthTexture).__webglTexture||I.depthTexture.image.width!==I.width||I.depthTexture.image.height!==I.height)&&(I.depthTexture.image.width=I.width,I.depthTexture.image.height=I.height,I.depthTexture.needsUpdate=!0),q(I.depthTexture,0);const Z=n.get(I.depthTexture).__webglTexture,st=te(I);if(I.depthTexture.format===kr)re(I)?a.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,i.DEPTH_ATTACHMENT,i.TEXTURE_2D,Z,0,st):i.framebufferTexture2D(i.FRAMEBUFFER,i.DEPTH_ATTACHMENT,i.TEXTURE_2D,Z,0);else if(I.depthTexture.format===Yr)re(I)?a.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,i.DEPTH_STENCIL_ATTACHMENT,i.TEXTURE_2D,Z,0,st):i.framebufferTexture2D(i.FRAMEBUFFER,i.DEPTH_STENCIL_ATTACHMENT,i.TEXTURE_2D,Z,0);else throw new Error("Unknown depthTexture format")}function Xt(U){const I=n.get(U),G=U.isWebGLCubeRenderTarget===!0;if(I.__boundDepthTexture!==U.depthTexture){const Z=U.depthTexture;if(I.__depthDisposeCallback&&I.__depthDisposeCallback(),Z){const st=()=>{delete I.__boundDepthTexture,delete I.__depthDisposeCallback,Z.removeEventListener("dispose",st)};Z.addEventListener("dispose",st),I.__depthDisposeCallback=st}I.__boundDepthTexture=Z}if(U.depthTexture&&!I.__autoAllocateDepthBuffer){if(G)throw new Error("target.depthTexture not supported in Cube render targets");vt(I.__webglFramebuffer,U)}else if(G){I.__webglDepthbuffer=[];for(let Z=0;Z<6;Z++)if(e.bindFramebuffer(i.FRAMEBUFFER,I.__webglFramebuffer[Z]),I.__webglDepthbuffer[Z]===void 0)I.__webglDepthbuffer[Z]=i.createRenderbuffer(),bt(I.__webglDepthbuffer[Z],U,!1);else{const st=U.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,Q=I.__webglDepthbuffer[Z];i.bindRenderbuffer(i.RENDERBUFFER,Q),i.framebufferRenderbuffer(i.FRAMEBUFFER,st,i.RENDERBUFFER,Q)}}else if(e.bindFramebuffer(i.FRAMEBUFFER,I.__webglFramebuffer),I.__webglDepthbuffer===void 0)I.__webglDepthbuffer=i.createRenderbuffer(),bt(I.__webglDepthbuffer,U,!1);else{const Z=U.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,st=I.__webglDepthbuffer;i.bindRenderbuffer(i.RENDERBUFFER,st),i.framebufferRenderbuffer(i.FRAMEBUFFER,Z,i.RENDERBUFFER,st)}e.bindFramebuffer(i.FRAMEBUFFER,null)}function Vt(U,I,G){const Z=n.get(U);I!==void 0&&rt(Z.__webglFramebuffer,U,U.texture,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,0),G!==void 0&&Xt(U)}function Qt(U){const I=U.texture,G=n.get(U),Z=n.get(I);U.addEventListener("dispose",N);const st=U.textures,Q=U.isWebGLCubeRenderTarget===!0,ft=st.length>1;if(ft||(Z.__webglTexture===void 0&&(Z.__webglTexture=i.createTexture()),Z.__version=I.version,o.memory.textures++),Q){G.__webglFramebuffer=[];for(let at=0;at<6;at++)if(I.mipmaps&&I.mipmaps.length>0){G.__webglFramebuffer[at]=[];for(let yt=0;yt<I.mipmaps.length;yt++)G.__webglFramebuffer[at][yt]=i.createFramebuffer()}else G.__webglFramebuffer[at]=i.createFramebuffer()}else{if(I.mipmaps&&I.mipmaps.length>0){G.__webglFramebuffer=[];for(let at=0;at<I.mipmaps.length;at++)G.__webglFramebuffer[at]=i.createFramebuffer()}else G.__webglFramebuffer=i.createFramebuffer();if(ft)for(let at=0,yt=st.length;at<yt;at++){const oe=n.get(st[at]);oe.__webglTexture===void 0&&(oe.__webglTexture=i.createTexture(),o.memory.textures++)}if(U.samples>0&&re(U)===!1){G.__webglMultisampledFramebuffer=i.createFramebuffer(),G.__webglColorRenderbuffer=[],e.bindFramebuffer(i.FRAMEBUFFER,G.__webglMultisampledFramebuffer);for(let at=0;at<st.length;at++){const yt=st[at];G.__webglColorRenderbuffer[at]=i.createRenderbuffer(),i.bindRenderbuffer(i.RENDERBUFFER,G.__webglColorRenderbuffer[at]);const oe=r.convert(yt.format,yt.colorSpace),ct=r.convert(yt.type),Mt=A(yt.internalFormat,oe,ct,yt.colorSpace,U.isXRRenderTarget===!0),Ut=te(U);i.renderbufferStorageMultisample(i.RENDERBUFFER,Ut,Mt,U.width,U.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+at,i.RENDERBUFFER,G.__webglColorRenderbuffer[at])}i.bindRenderbuffer(i.RENDERBUFFER,null),U.depthBuffer&&(G.__webglDepthRenderbuffer=i.createRenderbuffer(),bt(G.__webglDepthRenderbuffer,U,!0)),e.bindFramebuffer(i.FRAMEBUFFER,null)}}if(Q){e.bindTexture(i.TEXTURE_CUBE_MAP,Z.__webglTexture),Ct(i.TEXTURE_CUBE_MAP,I);for(let at=0;at<6;at++)if(I.mipmaps&&I.mipmaps.length>0)for(let yt=0;yt<I.mipmaps.length;yt++)rt(G.__webglFramebuffer[at][yt],U,I,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+at,yt);else rt(G.__webglFramebuffer[at],U,I,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+at,0);m(I)&&_(i.TEXTURE_CUBE_MAP),e.unbindTexture()}else if(ft){for(let at=0,yt=st.length;at<yt;at++){const oe=st[at],ct=n.get(oe);e.bindTexture(i.TEXTURE_2D,ct.__webglTexture),Ct(i.TEXTURE_2D,oe),rt(G.__webglFramebuffer,U,oe,i.COLOR_ATTACHMENT0+at,i.TEXTURE_2D,0),m(oe)&&_(i.TEXTURE_2D)}e.unbindTexture()}else{let at=i.TEXTURE_2D;if((U.isWebGL3DRenderTarget||U.isWebGLArrayRenderTarget)&&(at=U.isWebGL3DRenderTarget?i.TEXTURE_3D:i.TEXTURE_2D_ARRAY),e.bindTexture(at,Z.__webglTexture),Ct(at,I),I.mipmaps&&I.mipmaps.length>0)for(let yt=0;yt<I.mipmaps.length;yt++)rt(G.__webglFramebuffer[yt],U,I,i.COLOR_ATTACHMENT0,at,yt);else rt(G.__webglFramebuffer,U,I,i.COLOR_ATTACHMENT0,at,0);m(I)&&_(at),e.unbindTexture()}U.depthBuffer&&Xt(U)}function ue(U){const I=U.textures;for(let G=0,Z=I.length;G<Z;G++){const st=I[G];if(m(st)){const Q=U.isWebGLCubeRenderTarget?i.TEXTURE_CUBE_MAP:i.TEXTURE_2D,ft=n.get(st).__webglTexture;e.bindTexture(Q,ft),_(Q),e.unbindTexture()}}}const ne=[],V=[];function cn(U){if(U.samples>0){if(re(U)===!1){const I=U.textures,G=U.width,Z=U.height;let st=i.COLOR_BUFFER_BIT;const Q=U.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,ft=n.get(U),at=I.length>1;if(at)for(let yt=0;yt<I.length;yt++)e.bindFramebuffer(i.FRAMEBUFFER,ft.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+yt,i.RENDERBUFFER,null),e.bindFramebuffer(i.FRAMEBUFFER,ft.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+yt,i.TEXTURE_2D,null,0);e.bindFramebuffer(i.READ_FRAMEBUFFER,ft.__webglMultisampledFramebuffer),e.bindFramebuffer(i.DRAW_FRAMEBUFFER,ft.__webglFramebuffer);for(let yt=0;yt<I.length;yt++){if(U.resolveDepthBuffer&&(U.depthBuffer&&(st|=i.DEPTH_BUFFER_BIT),U.stencilBuffer&&U.resolveStencilBuffer&&(st|=i.STENCIL_BUFFER_BIT)),at){i.framebufferRenderbuffer(i.READ_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.RENDERBUFFER,ft.__webglColorRenderbuffer[yt]);const oe=n.get(I[yt]).__webglTexture;i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,oe,0)}i.blitFramebuffer(0,0,G,Z,0,0,G,Z,st,i.NEAREST),c===!0&&(ne.length=0,V.length=0,ne.push(i.COLOR_ATTACHMENT0+yt),U.depthBuffer&&U.resolveDepthBuffer===!1&&(ne.push(Q),V.push(Q),i.invalidateFramebuffer(i.DRAW_FRAMEBUFFER,V)),i.invalidateFramebuffer(i.READ_FRAMEBUFFER,ne))}if(e.bindFramebuffer(i.READ_FRAMEBUFFER,null),e.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),at)for(let yt=0;yt<I.length;yt++){e.bindFramebuffer(i.FRAMEBUFFER,ft.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+yt,i.RENDERBUFFER,ft.__webglColorRenderbuffer[yt]);const oe=n.get(I[yt]).__webglTexture;e.bindFramebuffer(i.FRAMEBUFFER,ft.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+yt,i.TEXTURE_2D,oe,0)}e.bindFramebuffer(i.DRAW_FRAMEBUFFER,ft.__webglMultisampledFramebuffer)}else if(U.depthBuffer&&U.resolveDepthBuffer===!1&&c){const I=U.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT;i.invalidateFramebuffer(i.DRAW_FRAMEBUFFER,[I])}}}function te(U){return Math.min(s.maxSamples,U.samples)}function re(U){const I=n.get(U);return U.samples>0&&t.has("WEBGL_multisampled_render_to_texture")===!0&&I.__useRenderToTexture!==!1}function kt(U){const I=o.render.frame;h.get(U)!==I&&(h.set(U,I),U.update())}function Te(U,I){const G=U.colorSpace,Z=U.format,st=U.type;return U.isCompressedTexture===!0||U.isVideoTexture===!0||G!==fn&&G!==ns&&(me.getTransfer(G)===Ie?(Z!==Xn||st!==ki)&&console.warn("THREE.WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):console.error("THREE.WebGLTextures: Unsupported texture color space:",G)),I}function zt(U){return typeof HTMLImageElement<"u"&&U instanceof HTMLImageElement?(l.width=U.naturalWidth||U.width,l.height=U.naturalHeight||U.height):typeof VideoFrame<"u"&&U instanceof VideoFrame?(l.width=U.displayWidth,l.height=U.displayHeight):(l.width=U.width,l.height=U.height),l}this.allocateTextureUnit=L,this.resetTextureUnits=E,this.setTexture2D=q,this.setTexture2DArray=nt,this.setTexture3D=j,this.setTextureCube=ot,this.rebindTextures=Vt,this.setupRenderTarget=Qt,this.updateRenderTargetMipmap=ue,this.updateMultisampleRenderTarget=cn,this.setupDepthRenderbuffer=Xt,this.setupFrameBufferTexture=rt,this.useMultisampledRTT=re}function wM(i,t){function e(n,s=ns){let r;const o=me.getTransfer(s);if(n===ki)return i.UNSIGNED_BYTE;if(n===_d)return i.UNSIGNED_SHORT_4_4_4_4;if(n===vd)return i.UNSIGNED_SHORT_5_5_5_1;if(n===t_)return i.UNSIGNED_INT_5_9_9_9_REV;if(n===Zg)return i.BYTE;if(n===Qg)return i.SHORT;if(n===la)return i.UNSIGNED_SHORT;if(n===gd)return i.INT;if(n===$s)return i.UNSIGNED_INT;if(n===si)return i.FLOAT;if(n===Ia)return i.HALF_FLOAT;if(n===e_)return i.ALPHA;if(n===n_)return i.RGB;if(n===Xn)return i.RGBA;if(n===i_)return i.LUMINANCE;if(n===s_)return i.LUMINANCE_ALPHA;if(n===kr)return i.DEPTH_COMPONENT;if(n===Yr)return i.DEPTH_STENCIL;if(n===yd)return i.RED;if(n===xd)return i.RED_INTEGER;if(n===r_)return i.RG;if(n===Ed)return i.RG_INTEGER;if(n===Td)return i.RGBA_INTEGER;if(n===Uc||n===Oc||n===Fc||n===Vc)if(o===Ie)if(r=t.get("WEBGL_compressed_texture_s3tc_srgb"),r!==null){if(n===Uc)return r.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(n===Oc)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(n===Fc)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(n===Vc)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(r=t.get("WEBGL_compressed_texture_s3tc"),r!==null){if(n===Uc)return r.COMPRESSED_RGB_S3TC_DXT1_EXT;if(n===Oc)return r.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(n===Fc)return r.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(n===Vc)return r.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(n===ch||n===lh||n===uh||n===hh)if(r=t.get("WEBGL_compressed_texture_pvrtc"),r!==null){if(n===ch)return r.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(n===lh)return r.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(n===uh)return r.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(n===hh)return r.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(n===dh||n===fh||n===ph)if(r=t.get("WEBGL_compressed_texture_etc"),r!==null){if(n===dh||n===fh)return o===Ie?r.COMPRESSED_SRGB8_ETC2:r.COMPRESSED_RGB8_ETC2;if(n===ph)return o===Ie?r.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:r.COMPRESSED_RGBA8_ETC2_EAC}else return null;if(n===mh||n===gh||n===_h||n===vh||n===yh||n===xh||n===Eh||n===Th||n===Sh||n===Ah||n===Mh||n===wh||n===bh||n===Rh)if(r=t.get("WEBGL_compressed_texture_astc"),r!==null){if(n===mh)return o===Ie?r.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:r.COMPRESSED_RGBA_ASTC_4x4_KHR;if(n===gh)return o===Ie?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:r.COMPRESSED_RGBA_ASTC_5x4_KHR;if(n===_h)return o===Ie?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:r.COMPRESSED_RGBA_ASTC_5x5_KHR;if(n===vh)return o===Ie?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:r.COMPRESSED_RGBA_ASTC_6x5_KHR;if(n===yh)return o===Ie?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:r.COMPRESSED_RGBA_ASTC_6x6_KHR;if(n===xh)return o===Ie?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:r.COMPRESSED_RGBA_ASTC_8x5_KHR;if(n===Eh)return o===Ie?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:r.COMPRESSED_RGBA_ASTC_8x6_KHR;if(n===Th)return o===Ie?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:r.COMPRESSED_RGBA_ASTC_8x8_KHR;if(n===Sh)return o===Ie?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:r.COMPRESSED_RGBA_ASTC_10x5_KHR;if(n===Ah)return o===Ie?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:r.COMPRESSED_RGBA_ASTC_10x6_KHR;if(n===Mh)return o===Ie?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:r.COMPRESSED_RGBA_ASTC_10x8_KHR;if(n===wh)return o===Ie?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:r.COMPRESSED_RGBA_ASTC_10x10_KHR;if(n===bh)return o===Ie?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:r.COMPRESSED_RGBA_ASTC_12x10_KHR;if(n===Rh)return o===Ie?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:r.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(n===Bc||n===Ih||n===Ch)if(r=t.get("EXT_texture_compression_bptc"),r!==null){if(n===Bc)return o===Ie?r.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:r.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(n===Ih)return r.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(n===Ch)return r.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(n===o_||n===Ph||n===Dh||n===Lh)if(r=t.get("EXT_texture_compression_rgtc"),r!==null){if(n===Bc)return r.COMPRESSED_RED_RGTC1_EXT;if(n===Ph)return r.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(n===Dh)return r.COMPRESSED_RED_GREEN_RGTC2_EXT;if(n===Lh)return r.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return n===$r?i.UNSIGNED_INT_24_8:i[n]!==void 0?i[n]:null}return{convert:e}}class bM extends Pn{constructor(t=[]){super(),this.isArrayCamera=!0,this.cameras=t}}class Xe extends Me{constructor(){super(),this.isGroup=!0,this.type="Group"}}const RM={type:"move"};class Au{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new Xe,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new Xe,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new O,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new O),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new Xe,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new O,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new O),this._grip}dispatchEvent(t){return this._targetRay!==null&&this._targetRay.dispatchEvent(t),this._grip!==null&&this._grip.dispatchEvent(t),this._hand!==null&&this._hand.dispatchEvent(t),this}connect(t){if(t&&t.hand){const e=this._hand;if(e)for(const n of t.hand.values())this._getHandJoint(e,n)}return this.dispatchEvent({type:"connected",data:t}),this}disconnect(t){return this.dispatchEvent({type:"disconnected",data:t}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(t,e,n){let s=null,r=null,o=null;const a=this._targetRay,c=this._grip,l=this._hand;if(t&&e.session.visibilityState!=="visible-blurred"){if(l&&t.hand){o=!0;for(const x of t.hand.values()){const m=e.getJointPose(x,n),_=this._getHandJoint(l,x);m!==null&&(_.matrix.fromArray(m.transform.matrix),_.matrix.decompose(_.position,_.rotation,_.scale),_.matrixWorldNeedsUpdate=!0,_.jointRadius=m.radius),_.visible=m!==null}const h=l.joints["index-finger-tip"],d=l.joints["thumb-tip"],f=h.position.distanceTo(d.position),p=.02,v=.005;l.inputState.pinching&&f>p+v?(l.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:t.handedness,target:this})):!l.inputState.pinching&&f<=p-v&&(l.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:t.handedness,target:this}))}else c!==null&&t.gripSpace&&(r=e.getPose(t.gripSpace,n),r!==null&&(c.matrix.fromArray(r.transform.matrix),c.matrix.decompose(c.position,c.rotation,c.scale),c.matrixWorldNeedsUpdate=!0,r.linearVelocity?(c.hasLinearVelocity=!0,c.linearVelocity.copy(r.linearVelocity)):c.hasLinearVelocity=!1,r.angularVelocity?(c.hasAngularVelocity=!0,c.angularVelocity.copy(r.angularVelocity)):c.hasAngularVelocity=!1));a!==null&&(s=e.getPose(t.targetRaySpace,n),s===null&&r!==null&&(s=r),s!==null&&(a.matrix.fromArray(s.transform.matrix),a.matrix.decompose(a.position,a.rotation,a.scale),a.matrixWorldNeedsUpdate=!0,s.linearVelocity?(a.hasLinearVelocity=!0,a.linearVelocity.copy(s.linearVelocity)):a.hasLinearVelocity=!1,s.angularVelocity?(a.hasAngularVelocity=!0,a.angularVelocity.copy(s.angularVelocity)):a.hasAngularVelocity=!1,this.dispatchEvent(RM)))}return a!==null&&(a.visible=s!==null),c!==null&&(c.visible=r!==null),l!==null&&(l.visible=o!==null),this}_getHandJoint(t,e){if(t.joints[e.jointName]===void 0){const n=new Xe;n.matrixAutoUpdate=!1,n.visible=!1,t.joints[e.jointName]=n,t.add(n)}return t.joints[e.jointName]}}const IM=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,CM=`
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;

void main() {

	vec2 coord = vec2( gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight );

	if ( coord.x >= 1.0 ) {

		gl_FragDepth = texture( depthColor, vec3( coord.x - 1.0, coord.y, 1 ) ).r;

	} else {

		gl_FragDepth = texture( depthColor, vec3( coord.x, coord.y, 0 ) ).r;

	}

}`;class PM{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(t,e,n){if(this.texture===null){const s=new Ze,r=t.properties.get(s);r.__webglTexture=e.texture,(e.depthNear!=n.depthNear||e.depthFar!=n.depthFar)&&(this.depthNear=e.depthNear,this.depthFar=e.depthFar),this.texture=s}}getMesh(t){if(this.texture!==null&&this.mesh===null){const e=t.cameras[0].viewport,n=new ms({vertexShader:IM,fragmentShader:CM,uniforms:{depthColor:{value:this.texture},depthWidth:{value:e.z},depthHeight:{value:e.w}}});this.mesh=new ve(new us(20,20),n)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}}class DM extends Ms{constructor(t,e){super();const n=this;let s=null,r=1,o=null,a="local-floor",c=1,l=null,h=null,d=null,f=null,p=null,v=null;const x=new PM,m=e.getContextAttributes();let _=null,A=null;const S=[],b=[],F=new dt;let N=null;const M=new Pn;M.layers.enable(1),M.viewport=new ge;const w=new Pn;w.layers.enable(2),w.viewport=new ge;const C=[M,w],y=new bM;y.layers.enable(1),y.layers.enable(2);let E=null,L=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(J){let rt=S[J];return rt===void 0&&(rt=new Au,S[J]=rt),rt.getTargetRaySpace()},this.getControllerGrip=function(J){let rt=S[J];return rt===void 0&&(rt=new Au,S[J]=rt),rt.getGripSpace()},this.getHand=function(J){let rt=S[J];return rt===void 0&&(rt=new Au,S[J]=rt),rt.getHandSpace()};function R(J){const rt=b.indexOf(J.inputSource);if(rt===-1)return;const bt=S[rt];bt!==void 0&&(bt.update(J.inputSource,J.frame,l||o),bt.dispatchEvent({type:J.type,data:J.inputSource}))}function q(){s.removeEventListener("select",R),s.removeEventListener("selectstart",R),s.removeEventListener("selectend",R),s.removeEventListener("squeeze",R),s.removeEventListener("squeezestart",R),s.removeEventListener("squeezeend",R),s.removeEventListener("end",q),s.removeEventListener("inputsourceschange",nt);for(let J=0;J<S.length;J++){const rt=b[J];rt!==null&&(b[J]=null,S[J].disconnect(rt))}E=null,L=null,x.reset(),t.setRenderTarget(_),p=null,f=null,d=null,s=null,A=null,Ht.stop(),n.isPresenting=!1,t.setPixelRatio(N),t.setSize(F.width,F.height,!1),n.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(J){r=J,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(J){a=J,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return l||o},this.setReferenceSpace=function(J){l=J},this.getBaseLayer=function(){return f!==null?f:p},this.getBinding=function(){return d},this.getFrame=function(){return v},this.getSession=function(){return s},this.setSession=async function(J){if(s=J,s!==null){if(_=t.getRenderTarget(),s.addEventListener("select",R),s.addEventListener("selectstart",R),s.addEventListener("selectend",R),s.addEventListener("squeeze",R),s.addEventListener("squeezestart",R),s.addEventListener("squeezeend",R),s.addEventListener("end",q),s.addEventListener("inputsourceschange",nt),m.xrCompatible!==!0&&await e.makeXRCompatible(),N=t.getPixelRatio(),t.getSize(F),s.renderState.layers===void 0){const rt={antialias:m.antialias,alpha:!0,depth:m.depth,stencil:m.stencil,framebufferScaleFactor:r};p=new XRWebGLLayer(s,e,rt),s.updateRenderState({baseLayer:p}),t.setPixelRatio(1),t.setSize(p.framebufferWidth,p.framebufferHeight,!1),A=new Ys(p.framebufferWidth,p.framebufferHeight,{format:Xn,type:ki,colorSpace:t.outputColorSpace,stencilBuffer:m.stencil})}else{let rt=null,bt=null,vt=null;m.depth&&(vt=m.stencil?e.DEPTH24_STENCIL8:e.DEPTH_COMPONENT24,rt=m.stencil?Yr:kr,bt=m.stencil?$r:$s);const Xt={colorFormat:e.RGBA8,depthFormat:vt,scaleFactor:r};d=new XRWebGLBinding(s,e),f=d.createProjectionLayer(Xt),s.updateRenderState({layers:[f]}),t.setPixelRatio(1),t.setSize(f.textureWidth,f.textureHeight,!1),A=new Ys(f.textureWidth,f.textureHeight,{format:Xn,type:ki,depthTexture:new y_(f.textureWidth,f.textureHeight,bt,void 0,void 0,void 0,void 0,void 0,void 0,rt),stencilBuffer:m.stencil,colorSpace:t.outputColorSpace,samples:m.antialias?4:0,resolveDepthBuffer:f.ignoreDepthValues===!1})}A.isXRRenderTarget=!0,this.setFoveation(c),l=null,o=await s.requestReferenceSpace(a),Ht.setContext(s),Ht.start(),n.isPresenting=!0,n.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(s!==null)return s.environmentBlendMode},this.getDepthTexture=function(){return x.getDepthTexture()};function nt(J){for(let rt=0;rt<J.removed.length;rt++){const bt=J.removed[rt],vt=b.indexOf(bt);vt>=0&&(b[vt]=null,S[vt].disconnect(bt))}for(let rt=0;rt<J.added.length;rt++){const bt=J.added[rt];let vt=b.indexOf(bt);if(vt===-1){for(let Vt=0;Vt<S.length;Vt++)if(Vt>=b.length){b.push(bt),vt=Vt;break}else if(b[Vt]===null){b[Vt]=bt,vt=Vt;break}if(vt===-1)break}const Xt=S[vt];Xt&&Xt.connect(bt)}}const j=new O,ot=new O;function Y(J,rt,bt){j.setFromMatrixPosition(rt.matrixWorld),ot.setFromMatrixPosition(bt.matrixWorld);const vt=j.distanceTo(ot),Xt=rt.projectionMatrix.elements,Vt=bt.projectionMatrix.elements,Qt=Xt[14]/(Xt[10]-1),ue=Xt[14]/(Xt[10]+1),ne=(Xt[9]+1)/Xt[5],V=(Xt[9]-1)/Xt[5],cn=(Xt[8]-1)/Xt[0],te=(Vt[8]+1)/Vt[0],re=Qt*cn,kt=Qt*te,Te=vt/(-cn+te),zt=Te*-cn;if(rt.matrixWorld.decompose(J.position,J.quaternion,J.scale),J.translateX(zt),J.translateZ(Te),J.matrixWorld.compose(J.position,J.quaternion,J.scale),J.matrixWorldInverse.copy(J.matrixWorld).invert(),Xt[10]===-1)J.projectionMatrix.copy(rt.projectionMatrix),J.projectionMatrixInverse.copy(rt.projectionMatrixInverse);else{const U=Qt+Te,I=ue+Te,G=re-zt,Z=kt+(vt-zt),st=ne*ue/I*U,Q=V*ue/I*U;J.projectionMatrix.makePerspective(G,Z,st,Q,U,I),J.projectionMatrixInverse.copy(J.projectionMatrix).invert()}}function Et(J,rt){rt===null?J.matrixWorld.copy(J.matrix):J.matrixWorld.multiplyMatrices(rt.matrixWorld,J.matrix),J.matrixWorldInverse.copy(J.matrixWorld).invert()}this.updateCamera=function(J){if(s===null)return;let rt=J.near,bt=J.far;x.texture!==null&&(x.depthNear>0&&(rt=x.depthNear),x.depthFar>0&&(bt=x.depthFar)),y.near=w.near=M.near=rt,y.far=w.far=M.far=bt,(E!==y.near||L!==y.far)&&(s.updateRenderState({depthNear:y.near,depthFar:y.far}),E=y.near,L=y.far);const vt=J.parent,Xt=y.cameras;Et(y,vt);for(let Vt=0;Vt<Xt.length;Vt++)Et(Xt[Vt],vt);Xt.length===2?Y(y,M,w):y.projectionMatrix.copy(M.projectionMatrix),Tt(J,y,vt)};function Tt(J,rt,bt){bt===null?J.matrix.copy(rt.matrixWorld):(J.matrix.copy(bt.matrixWorld),J.matrix.invert(),J.matrix.multiply(rt.matrixWorld)),J.matrix.decompose(J.position,J.quaternion,J.scale),J.updateMatrixWorld(!0),J.projectionMatrix.copy(rt.projectionMatrix),J.projectionMatrixInverse.copy(rt.projectionMatrixInverse),J.isPerspectiveCamera&&(J.fov=Jr*2*Math.atan(1/J.projectionMatrix.elements[5]),J.zoom=1)}this.getCamera=function(){return y},this.getFoveation=function(){if(!(f===null&&p===null))return c},this.setFoveation=function(J){c=J,f!==null&&(f.fixedFoveation=J),p!==null&&p.fixedFoveation!==void 0&&(p.fixedFoveation=J)},this.hasDepthSensing=function(){return x.texture!==null},this.getDepthSensingMesh=function(){return x.getMesh(y)};let Ct=null;function $t(J,rt){if(h=rt.getViewerPose(l||o),v=rt,h!==null){const bt=h.views;p!==null&&(t.setRenderTargetFramebuffer(A,p.framebuffer),t.setRenderTarget(A));let vt=!1;bt.length!==y.cameras.length&&(y.cameras.length=0,vt=!0);for(let Vt=0;Vt<bt.length;Vt++){const Qt=bt[Vt];let ue=null;if(p!==null)ue=p.getViewport(Qt);else{const V=d.getViewSubImage(f,Qt);ue=V.viewport,Vt===0&&(t.setRenderTargetTextures(A,V.colorTexture,f.ignoreDepthValues?void 0:V.depthStencilTexture),t.setRenderTarget(A))}let ne=C[Vt];ne===void 0&&(ne=new Pn,ne.layers.enable(Vt),ne.viewport=new ge,C[Vt]=ne),ne.matrix.fromArray(Qt.transform.matrix),ne.matrix.decompose(ne.position,ne.quaternion,ne.scale),ne.projectionMatrix.fromArray(Qt.projectionMatrix),ne.projectionMatrixInverse.copy(ne.projectionMatrix).invert(),ne.viewport.set(ue.x,ue.y,ue.width,ue.height),Vt===0&&(y.matrix.copy(ne.matrix),y.matrix.decompose(y.position,y.quaternion,y.scale)),vt===!0&&y.cameras.push(ne)}const Xt=s.enabledFeatures;if(Xt&&Xt.includes("depth-sensing")){const Vt=d.getDepthInformation(bt[0]);Vt&&Vt.isValid&&Vt.texture&&x.init(t,Vt,s.renderState)}}for(let bt=0;bt<S.length;bt++){const vt=b[bt],Xt=S[bt];vt!==null&&Xt!==void 0&&Xt.update(vt,rt,l||o)}Ct&&Ct(J,rt),rt.detectedPlanes&&n.dispatchEvent({type:"planesdetected",data:rt}),v=null}const Ht=new v_;Ht.setAnimationLoop($t),this.setAnimationLoop=function(J){Ct=J},this.dispose=function(){}}}const Ls=new ai,LM=new Gt;function NM(i,t){function e(m,_){m.matrixAutoUpdate===!0&&m.updateMatrix(),_.value.copy(m.matrix)}function n(m,_){_.color.getRGB(m.fogColor.value,m_(i)),_.isFog?(m.fogNear.value=_.near,m.fogFar.value=_.far):_.isFogExp2&&(m.fogDensity.value=_.density)}function s(m,_,A,S,b){_.isMeshBasicMaterial||_.isMeshLambertMaterial?r(m,_):_.isMeshToonMaterial?(r(m,_),d(m,_)):_.isMeshPhongMaterial?(r(m,_),h(m,_)):_.isMeshStandardMaterial?(r(m,_),f(m,_),_.isMeshPhysicalMaterial&&p(m,_,b)):_.isMeshMatcapMaterial?(r(m,_),v(m,_)):_.isMeshDepthMaterial?r(m,_):_.isMeshDistanceMaterial?(r(m,_),x(m,_)):_.isMeshNormalMaterial?r(m,_):_.isLineBasicMaterial?(o(m,_),_.isLineDashedMaterial&&a(m,_)):_.isPointsMaterial?c(m,_,A,S):_.isSpriteMaterial?l(m,_):_.isShadowMaterial?(m.color.value.copy(_.color),m.opacity.value=_.opacity):_.isShaderMaterial&&(_.uniformsNeedUpdate=!1)}function r(m,_){m.opacity.value=_.opacity,_.color&&m.diffuse.value.copy(_.color),_.emissive&&m.emissive.value.copy(_.emissive).multiplyScalar(_.emissiveIntensity),_.map&&(m.map.value=_.map,e(_.map,m.mapTransform)),_.alphaMap&&(m.alphaMap.value=_.alphaMap,e(_.alphaMap,m.alphaMapTransform)),_.bumpMap&&(m.bumpMap.value=_.bumpMap,e(_.bumpMap,m.bumpMapTransform),m.bumpScale.value=_.bumpScale,_.side===Dn&&(m.bumpScale.value*=-1)),_.normalMap&&(m.normalMap.value=_.normalMap,e(_.normalMap,m.normalMapTransform),m.normalScale.value.copy(_.normalScale),_.side===Dn&&m.normalScale.value.negate()),_.displacementMap&&(m.displacementMap.value=_.displacementMap,e(_.displacementMap,m.displacementMapTransform),m.displacementScale.value=_.displacementScale,m.displacementBias.value=_.displacementBias),_.emissiveMap&&(m.emissiveMap.value=_.emissiveMap,e(_.emissiveMap,m.emissiveMapTransform)),_.specularMap&&(m.specularMap.value=_.specularMap,e(_.specularMap,m.specularMapTransform)),_.alphaTest>0&&(m.alphaTest.value=_.alphaTest);const A=t.get(_),S=A.envMap,b=A.envMapRotation;S&&(m.envMap.value=S,Ls.copy(b),Ls.x*=-1,Ls.y*=-1,Ls.z*=-1,S.isCubeTexture&&S.isRenderTargetTexture===!1&&(Ls.y*=-1,Ls.z*=-1),m.envMapRotation.value.setFromMatrix4(LM.makeRotationFromEuler(Ls)),m.flipEnvMap.value=S.isCubeTexture&&S.isRenderTargetTexture===!1?-1:1,m.reflectivity.value=_.reflectivity,m.ior.value=_.ior,m.refractionRatio.value=_.refractionRatio),_.lightMap&&(m.lightMap.value=_.lightMap,m.lightMapIntensity.value=_.lightMapIntensity,e(_.lightMap,m.lightMapTransform)),_.aoMap&&(m.aoMap.value=_.aoMap,m.aoMapIntensity.value=_.aoMapIntensity,e(_.aoMap,m.aoMapTransform))}function o(m,_){m.diffuse.value.copy(_.color),m.opacity.value=_.opacity,_.map&&(m.map.value=_.map,e(_.map,m.mapTransform))}function a(m,_){m.dashSize.value=_.dashSize,m.totalSize.value=_.dashSize+_.gapSize,m.scale.value=_.scale}function c(m,_,A,S){m.diffuse.value.copy(_.color),m.opacity.value=_.opacity,m.size.value=_.size*A,m.scale.value=S*.5,_.map&&(m.map.value=_.map,e(_.map,m.uvTransform)),_.alphaMap&&(m.alphaMap.value=_.alphaMap,e(_.alphaMap,m.alphaMapTransform)),_.alphaTest>0&&(m.alphaTest.value=_.alphaTest)}function l(m,_){m.diffuse.value.copy(_.color),m.opacity.value=_.opacity,m.rotation.value=_.rotation,_.map&&(m.map.value=_.map,e(_.map,m.mapTransform)),_.alphaMap&&(m.alphaMap.value=_.alphaMap,e(_.alphaMap,m.alphaMapTransform)),_.alphaTest>0&&(m.alphaTest.value=_.alphaTest)}function h(m,_){m.specular.value.copy(_.specular),m.shininess.value=Math.max(_.shininess,1e-4)}function d(m,_){_.gradientMap&&(m.gradientMap.value=_.gradientMap)}function f(m,_){m.metalness.value=_.metalness,_.metalnessMap&&(m.metalnessMap.value=_.metalnessMap,e(_.metalnessMap,m.metalnessMapTransform)),m.roughness.value=_.roughness,_.roughnessMap&&(m.roughnessMap.value=_.roughnessMap,e(_.roughnessMap,m.roughnessMapTransform)),_.envMap&&(m.envMapIntensity.value=_.envMapIntensity)}function p(m,_,A){m.ior.value=_.ior,_.sheen>0&&(m.sheenColor.value.copy(_.sheenColor).multiplyScalar(_.sheen),m.sheenRoughness.value=_.sheenRoughness,_.sheenColorMap&&(m.sheenColorMap.value=_.sheenColorMap,e(_.sheenColorMap,m.sheenColorMapTransform)),_.sheenRoughnessMap&&(m.sheenRoughnessMap.value=_.sheenRoughnessMap,e(_.sheenRoughnessMap,m.sheenRoughnessMapTransform))),_.clearcoat>0&&(m.clearcoat.value=_.clearcoat,m.clearcoatRoughness.value=_.clearcoatRoughness,_.clearcoatMap&&(m.clearcoatMap.value=_.clearcoatMap,e(_.clearcoatMap,m.clearcoatMapTransform)),_.clearcoatRoughnessMap&&(m.clearcoatRoughnessMap.value=_.clearcoatRoughnessMap,e(_.clearcoatRoughnessMap,m.clearcoatRoughnessMapTransform)),_.clearcoatNormalMap&&(m.clearcoatNormalMap.value=_.clearcoatNormalMap,e(_.clearcoatNormalMap,m.clearcoatNormalMapTransform),m.clearcoatNormalScale.value.copy(_.clearcoatNormalScale),_.side===Dn&&m.clearcoatNormalScale.value.negate())),_.dispersion>0&&(m.dispersion.value=_.dispersion),_.iridescence>0&&(m.iridescence.value=_.iridescence,m.iridescenceIOR.value=_.iridescenceIOR,m.iridescenceThicknessMinimum.value=_.iridescenceThicknessRange[0],m.iridescenceThicknessMaximum.value=_.iridescenceThicknessRange[1],_.iridescenceMap&&(m.iridescenceMap.value=_.iridescenceMap,e(_.iridescenceMap,m.iridescenceMapTransform)),_.iridescenceThicknessMap&&(m.iridescenceThicknessMap.value=_.iridescenceThicknessMap,e(_.iridescenceThicknessMap,m.iridescenceThicknessMapTransform))),_.transmission>0&&(m.transmission.value=_.transmission,m.transmissionSamplerMap.value=A.texture,m.transmissionSamplerSize.value.set(A.width,A.height),_.transmissionMap&&(m.transmissionMap.value=_.transmissionMap,e(_.transmissionMap,m.transmissionMapTransform)),m.thickness.value=_.thickness,_.thicknessMap&&(m.thicknessMap.value=_.thicknessMap,e(_.thicknessMap,m.thicknessMapTransform)),m.attenuationDistance.value=_.attenuationDistance,m.attenuationColor.value.copy(_.attenuationColor)),_.anisotropy>0&&(m.anisotropyVector.value.set(_.anisotropy*Math.cos(_.anisotropyRotation),_.anisotropy*Math.sin(_.anisotropyRotation)),_.anisotropyMap&&(m.anisotropyMap.value=_.anisotropyMap,e(_.anisotropyMap,m.anisotropyMapTransform))),m.specularIntensity.value=_.specularIntensity,m.specularColor.value.copy(_.specularColor),_.specularColorMap&&(m.specularColorMap.value=_.specularColorMap,e(_.specularColorMap,m.specularColorMapTransform)),_.specularIntensityMap&&(m.specularIntensityMap.value=_.specularIntensityMap,e(_.specularIntensityMap,m.specularIntensityMapTransform))}function v(m,_){_.matcap&&(m.matcap.value=_.matcap)}function x(m,_){const A=t.get(_).light;m.referencePosition.value.setFromMatrixPosition(A.matrixWorld),m.nearDistance.value=A.shadow.camera.near,m.farDistance.value=A.shadow.camera.far}return{refreshFogUniforms:n,refreshMaterialUniforms:s}}function UM(i,t,e,n){let s={},r={},o=[];const a=i.getParameter(i.MAX_UNIFORM_BUFFER_BINDINGS);function c(A,S){const b=S.program;n.uniformBlockBinding(A,b)}function l(A,S){let b=s[A.id];b===void 0&&(v(A),b=h(A),s[A.id]=b,A.addEventListener("dispose",m));const F=S.program;n.updateUBOMapping(A,F);const N=t.render.frame;r[A.id]!==N&&(f(A),r[A.id]=N)}function h(A){const S=d();A.__bindingPointIndex=S;const b=i.createBuffer(),F=A.__size,N=A.usage;return i.bindBuffer(i.UNIFORM_BUFFER,b),i.bufferData(i.UNIFORM_BUFFER,F,N),i.bindBuffer(i.UNIFORM_BUFFER,null),i.bindBufferBase(i.UNIFORM_BUFFER,S,b),b}function d(){for(let A=0;A<a;A++)if(o.indexOf(A)===-1)return o.push(A),A;return console.error("THREE.WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function f(A){const S=s[A.id],b=A.uniforms,F=A.__cache;i.bindBuffer(i.UNIFORM_BUFFER,S);for(let N=0,M=b.length;N<M;N++){const w=Array.isArray(b[N])?b[N]:[b[N]];for(let C=0,y=w.length;C<y;C++){const E=w[C];if(p(E,N,C,F)===!0){const L=E.__offset,R=Array.isArray(E.value)?E.value:[E.value];let q=0;for(let nt=0;nt<R.length;nt++){const j=R[nt],ot=x(j);typeof j=="number"||typeof j=="boolean"?(E.__data[0]=j,i.bufferSubData(i.UNIFORM_BUFFER,L+q,E.__data)):j.isMatrix3?(E.__data[0]=j.elements[0],E.__data[1]=j.elements[1],E.__data[2]=j.elements[2],E.__data[3]=0,E.__data[4]=j.elements[3],E.__data[5]=j.elements[4],E.__data[6]=j.elements[5],E.__data[7]=0,E.__data[8]=j.elements[6],E.__data[9]=j.elements[7],E.__data[10]=j.elements[8],E.__data[11]=0):(j.toArray(E.__data,q),q+=ot.storage/Float32Array.BYTES_PER_ELEMENT)}i.bufferSubData(i.UNIFORM_BUFFER,L,E.__data)}}}i.bindBuffer(i.UNIFORM_BUFFER,null)}function p(A,S,b,F){const N=A.value,M=S+"_"+b;if(F[M]===void 0)return typeof N=="number"||typeof N=="boolean"?F[M]=N:F[M]=N.clone(),!0;{const w=F[M];if(typeof N=="number"||typeof N=="boolean"){if(w!==N)return F[M]=N,!0}else if(w.equals(N)===!1)return w.copy(N),!0}return!1}function v(A){const S=A.uniforms;let b=0;const F=16;for(let M=0,w=S.length;M<w;M++){const C=Array.isArray(S[M])?S[M]:[S[M]];for(let y=0,E=C.length;y<E;y++){const L=C[y],R=Array.isArray(L.value)?L.value:[L.value];for(let q=0,nt=R.length;q<nt;q++){const j=R[q],ot=x(j),Y=b%F,Et=Y%ot.boundary,Tt=Y+Et;b+=Et,Tt!==0&&F-Tt<ot.storage&&(b+=F-Tt),L.__data=new Float32Array(ot.storage/Float32Array.BYTES_PER_ELEMENT),L.__offset=b,b+=ot.storage}}}const N=b%F;return N>0&&(b+=F-N),A.__size=b,A.__cache={},this}function x(A){const S={boundary:0,storage:0};return typeof A=="number"||typeof A=="boolean"?(S.boundary=4,S.storage=4):A.isVector2?(S.boundary=8,S.storage=8):A.isVector3||A.isColor?(S.boundary=16,S.storage=12):A.isVector4?(S.boundary=16,S.storage=16):A.isMatrix3?(S.boundary=48,S.storage=48):A.isMatrix4?(S.boundary=64,S.storage=64):A.isTexture?console.warn("THREE.WebGLRenderer: Texture samplers can not be part of an uniforms group."):console.warn("THREE.WebGLRenderer: Unsupported uniform value type.",A),S}function m(A){const S=A.target;S.removeEventListener("dispose",m);const b=o.indexOf(S.__bindingPointIndex);o.splice(b,1),i.deleteBuffer(s[S.id]),delete s[S.id],delete r[S.id]}function _(){for(const A in s)i.deleteBuffer(s[A]);o=[],s={},r={}}return{bind:c,update:l,dispose:_}}class k2{constructor(t={}){const{canvas:e=Sx(),context:n=null,depth:s=!0,stencil:r=!1,alpha:o=!1,antialias:a=!1,premultipliedAlpha:c=!0,preserveDrawingBuffer:l=!1,powerPreference:h="default",failIfMajorPerformanceCaveat:d=!1}=t;this.isWebGLRenderer=!0;let f;if(n!==null){if(typeof WebGLRenderingContext<"u"&&n instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");f=n.getContextAttributes().alpha}else f=o;const p=new Uint32Array(4),v=new Int32Array(4);let x=null,m=null;const _=[],A=[];this.domElement=e,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this._outputColorSpace=hn,this.toneMapping=ls,this.toneMappingExposure=1;const S=this;let b=!1,F=0,N=0,M=null,w=-1,C=null;const y=new ge,E=new ge;let L=null;const R=new It(0);let q=0,nt=e.width,j=e.height,ot=1,Y=null,Et=null;const Tt=new ge(0,0,nt,j),Ct=new ge(0,0,nt,j);let $t=!1;const Ht=new Rd;let J=!1,rt=!1;const bt=new Gt,vt=new Gt,Xt=new O,Vt=new ge,Qt={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0};let ue=!1;function ne(){return M===null?ot:1}let V=n;function cn(P,k){return e.getContext(P,k)}try{const P={alpha:!0,depth:s,stencil:r,antialias:a,premultipliedAlpha:c,preserveDrawingBuffer:l,powerPreference:h,failIfMajorPerformanceCaveat:d};if("setAttribute"in e&&e.setAttribute("data-engine",`three.js r${pd}`),e.addEventListener("webglcontextlost",et,!1),e.addEventListener("webglcontextrestored",pt,!1),e.addEventListener("webglcontextcreationerror",mt,!1),V===null){const k="webgl2";if(V=cn(k,P),V===null)throw cn(k)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}}catch(P){throw console.error("THREE.WebGLRenderer: "+P.message),P}let te,re,kt,Te,zt,U,I,G,Z,st,Q,ft,at,yt,oe,ct,Mt,Ut,Bt,St,ee,qt,Ee,B;function _t(){te=new zS(V),te.init(),qt=new wM(V,te),re=new US(V,te,t,qt),kt=new SM(V),re.reverseDepthBuffer&&kt.buffers.depth.setReversed(!0),Te=new WS(V),zt=new cM,U=new MM(V,te,kt,zt,re,qt,Te),I=new FS(S),G=new kS(S),Z=new Jx(V),Ee=new LS(V,Z),st=new HS(V,Z,Te,Ee),Q=new qS(V,st,Z,Te),Bt=new XS(V,re,U),ct=new OS(zt),ft=new aM(S,I,G,te,re,Ee,ct),at=new NM(S,zt),yt=new uM,oe=new gM(te),Ut=new DS(S,I,G,kt,Q,f,c),Mt=new EM(S,Q,re),B=new UM(V,Te,re,kt),St=new NS(V,te,Te),ee=new GS(V,te,Te),Te.programs=ft.programs,S.capabilities=re,S.extensions=te,S.properties=zt,S.renderLists=yt,S.shadowMap=Mt,S.state=kt,S.info=Te}_t();const $=new DM(S,V);this.xr=$,this.getContext=function(){return V},this.getContextAttributes=function(){return V.getContextAttributes()},this.forceContextLoss=function(){const P=te.get("WEBGL_lose_context");P&&P.loseContext()},this.forceContextRestore=function(){const P=te.get("WEBGL_lose_context");P&&P.restoreContext()},this.getPixelRatio=function(){return ot},this.setPixelRatio=function(P){P!==void 0&&(ot=P,this.setSize(nt,j,!1))},this.getSize=function(P){return P.set(nt,j)},this.setSize=function(P,k,W=!0){if($.isPresenting){console.warn("THREE.WebGLRenderer: Can't change size while VR device is presenting.");return}nt=P,j=k,e.width=Math.floor(P*ot),e.height=Math.floor(k*ot),W===!0&&(e.style.width=P+"px",e.style.height=k+"px"),this.setViewport(0,0,P,k)},this.getDrawingBufferSize=function(P){return P.set(nt*ot,j*ot).floor()},this.setDrawingBufferSize=function(P,k,W){nt=P,j=k,ot=W,e.width=Math.floor(P*W),e.height=Math.floor(k*W),this.setViewport(0,0,P,k)},this.getCurrentViewport=function(P){return P.copy(y)},this.getViewport=function(P){return P.copy(Tt)},this.setViewport=function(P,k,W,X){P.isVector4?Tt.set(P.x,P.y,P.z,P.w):Tt.set(P,k,W,X),kt.viewport(y.copy(Tt).multiplyScalar(ot).round())},this.getScissor=function(P){return P.copy(Ct)},this.setScissor=function(P,k,W,X){P.isVector4?Ct.set(P.x,P.y,P.z,P.w):Ct.set(P,k,W,X),kt.scissor(E.copy(Ct).multiplyScalar(ot).round())},this.getScissorTest=function(){return $t},this.setScissorTest=function(P){kt.setScissorTest($t=P)},this.setOpaqueSort=function(P){Y=P},this.setTransparentSort=function(P){Et=P},this.getClearColor=function(P){return P.copy(Ut.getClearColor())},this.setClearColor=function(){Ut.setClearColor.apply(Ut,arguments)},this.getClearAlpha=function(){return Ut.getClearAlpha()},this.setClearAlpha=function(){Ut.setClearAlpha.apply(Ut,arguments)},this.clear=function(P=!0,k=!0,W=!0){let X=0;if(P){let z=!1;if(M!==null){const lt=M.texture.format;z=lt===Td||lt===Ed||lt===xd}if(z){const lt=M.texture.type,gt=lt===ki||lt===$s||lt===la||lt===$r||lt===_d||lt===vd,At=Ut.getClearColor(),Rt=Ut.getClearAlpha(),Ot=At.r,Nt=At.g,wt=At.b;gt?(p[0]=Ot,p[1]=Nt,p[2]=wt,p[3]=Rt,V.clearBufferuiv(V.COLOR,0,p)):(v[0]=Ot,v[1]=Nt,v[2]=wt,v[3]=Rt,V.clearBufferiv(V.COLOR,0,v))}else X|=V.COLOR_BUFFER_BIT}k&&(X|=V.DEPTH_BUFFER_BIT,V.clearDepth(this.capabilities.reverseDepthBuffer?0:1)),W&&(X|=V.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),V.clear(X)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.dispose=function(){e.removeEventListener("webglcontextlost",et,!1),e.removeEventListener("webglcontextrestored",pt,!1),e.removeEventListener("webglcontextcreationerror",mt,!1),yt.dispose(),oe.dispose(),zt.dispose(),I.dispose(),G.dispose(),Q.dispose(),Ee.dispose(),B.dispose(),ft.dispose(),$.dispose(),$.removeEventListener("sessionstart",nn),$.removeEventListener("sessionend",yo),Ln.stop()};function et(P){P.preventDefault(),console.log("THREE.WebGLRenderer: Context Lost."),b=!0}function pt(){console.log("THREE.WebGLRenderer: Context Restored."),b=!1;const P=Te.autoReset,k=Mt.enabled,W=Mt.autoUpdate,X=Mt.needsUpdate,z=Mt.type;_t(),Te.autoReset=P,Mt.enabled=k,Mt.autoUpdate=W,Mt.needsUpdate=X,Mt.type=z}function mt(P){console.error("THREE.WebGLRenderer: A WebGL context could not be created. Reason: ",P.statusMessage)}function Kt(P){const k=P.target;k.removeEventListener("dispose",Kt),Ne(k)}function Ne(P){je(P),zt.remove(P)}function je(P){const k=zt.get(P).programs;k!==void 0&&(k.forEach(function(W){ft.releaseProgram(W)}),P.isShaderMaterial&&ft.releaseShaderCache(P))}this.renderBufferDirect=function(P,k,W,X,z,lt){k===null&&(k=Qt);const gt=z.isMesh&&z.matrixWorld.determinant()<0,At=Eo(P,k,W,X,z);kt.setMaterial(X,gt);let Rt=W.index,Ot=1;if(X.wireframe===!0){if(Rt=st.getWireframeAttribute(W),Rt===void 0)return;Ot=2}const Nt=W.drawRange,wt=W.attributes.position;let he=Nt.start*Ot,Se=(Nt.start+Nt.count)*Ot;lt!==null&&(he=Math.max(he,lt.start*Ot),Se=Math.min(Se,(lt.start+lt.count)*Ot)),Rt!==null?(he=Math.max(he,0),Se=Math.min(Se,Rt.count)):wt!=null&&(he=Math.max(he,0),Se=Math.min(Se,wt.count));const be=Se-he;if(be<0||be===1/0)return;Ee.setup(z,X,At,W,Rt);let gn,de=St;if(Rt!==null&&(gn=Z.get(Rt),de=ee,de.setIndex(gn)),z.isMesh)X.wireframe===!0?(kt.setLineWidth(X.wireframeLinewidth*ne()),de.setMode(V.LINES)):de.setMode(V.TRIANGLES);else if(z.isLine){let Pt=X.linewidth;Pt===void 0&&(Pt=1),kt.setLineWidth(Pt*ne()),z.isLineSegments?de.setMode(V.LINES):z.isLineLoop?de.setMode(V.LINE_LOOP):de.setMode(V.LINE_STRIP)}else z.isPoints?de.setMode(V.POINTS):z.isSprite&&de.setMode(V.TRIANGLES);if(z.isBatchedMesh)if(z._multiDrawInstances!==null)de.renderMultiDrawInstances(z._multiDrawStarts,z._multiDrawCounts,z._multiDrawCount,z._multiDrawInstances);else if(te.get("WEBGL_multi_draw"))de.renderMultiDraw(z._multiDrawStarts,z._multiDrawCounts,z._multiDrawCount);else{const Pt=z._multiDrawStarts,Be=z._multiDrawCounts,fe=z._multiDrawCount,In=Rt?Z.get(Rt).bytesPerElement:1,Wi=zt.get(X).currentProgram.getUniforms();for(let Mn=0;Mn<fe;Mn++)Wi.setValue(V,"_gl_DrawID",Mn),de.render(Pt[Mn]/In,Be[Mn])}else if(z.isInstancedMesh)de.renderInstances(he,be,z.count);else if(W.isInstancedBufferGeometry){const Pt=W._maxInstanceCount!==void 0?W._maxInstanceCount:1/0,Be=Math.min(W.instanceCount,Pt);de.renderInstances(he,be,Be)}else de.render(he,be)};function ae(P,k,W){P.transparent===!0&&P.side===ei&&P.forceSinglePass===!1?(P.side=Dn,P.needsUpdate=!0,sr(P,k,W),P.side=yi,P.needsUpdate=!0,sr(P,k,W),P.side=ei):sr(P,k,W)}this.compile=function(P,k,W=null){W===null&&(W=P),m=oe.get(W),m.init(k),A.push(m),W.traverseVisible(function(z){z.isLight&&z.layers.test(k.layers)&&(m.pushLight(z),z.castShadow&&m.pushShadow(z))}),P!==W&&P.traverseVisible(function(z){z.isLight&&z.layers.test(k.layers)&&(m.pushLight(z),z.castShadow&&m.pushShadow(z))}),m.setupLights();const X=new Set;return P.traverse(function(z){if(!(z.isMesh||z.isPoints||z.isLine||z.isSprite))return;const lt=z.material;if(lt)if(Array.isArray(lt))for(let gt=0;gt<lt.length;gt++){const At=lt[gt];ae(At,W,z),X.add(At)}else ae(lt,W,z),X.add(lt)}),A.pop(),m=null,X},this.compileAsync=function(P,k,W=null){const X=this.compile(P,k,W);return new Promise(z=>{function lt(){if(X.forEach(function(gt){zt.get(gt).currentProgram.isReady()&&X.delete(gt)}),X.size===0){z(P);return}setTimeout(lt,10)}te.get("KHR_parallel_shader_compile")!==null?lt():setTimeout(lt,10)})};let ze=null;function Vn(P){ze&&ze(P)}function nn(){Ln.stop()}function yo(){Ln.start()}const Ln=new v_;Ln.setAnimationLoop(Vn),typeof self<"u"&&Ln.setContext(self),this.setAnimationLoop=function(P){ze=P,$.setAnimationLoop(P),P===null?Ln.stop():Ln.start()},$.addEventListener("sessionstart",nn),$.addEventListener("sessionend",yo),this.render=function(P,k){if(k!==void 0&&k.isCamera!==!0){console.error("THREE.WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(b===!0)return;if(P.matrixWorldAutoUpdate===!0&&P.updateMatrixWorld(),k.parent===null&&k.matrixWorldAutoUpdate===!0&&k.updateMatrixWorld(),$.enabled===!0&&$.isPresenting===!0&&($.cameraAutoUpdate===!0&&$.updateCamera(k),k=$.getCamera()),P.isScene===!0&&P.onBeforeRender(S,P,k,M),m=oe.get(P,A.length),m.init(k),A.push(m),vt.multiplyMatrices(k.projectionMatrix,k.matrixWorldInverse),Ht.setFromProjectionMatrix(vt),rt=this.localClippingEnabled,J=ct.init(this.clippingPlanes,rt),x=yt.get(P,_.length),x.init(),_.push(x),$.enabled===!0&&$.isPresenting===!0){const lt=S.xr.getDepthSensingMesh();lt!==null&&bi(lt,k,-1/0,S.sortObjects)}bi(P,k,0,S.sortObjects),x.finish(),S.sortObjects===!0&&x.sort(Y,Et),ue=$.enabled===!1||$.isPresenting===!1||$.hasDepthSensing()===!1,ue&&Ut.addToRenderList(x,P),this.info.render.frame++,J===!0&&ct.beginShadows();const W=m.state.shadowsArray;Mt.render(W,P,k),J===!0&&ct.endShadows(),this.info.autoReset===!0&&this.info.reset();const X=x.opaque,z=x.transmissive;if(m.setupLights(),k.isArrayCamera){const lt=k.cameras;if(z.length>0)for(let gt=0,At=lt.length;gt<At;gt++){const Rt=lt[gt];Ba(X,z,P,Rt)}ue&&Ut.render(P);for(let gt=0,At=lt.length;gt<At;gt++){const Rt=lt[gt];Va(x,P,Rt,Rt.viewport)}}else z.length>0&&Ba(X,z,P,k),ue&&Ut.render(P),Va(x,P,k);M!==null&&(U.updateMultisampleRenderTarget(M),U.updateRenderTargetMipmap(M)),P.isScene===!0&&P.onAfterRender(S,P,k),Ee.resetDefaultState(),w=-1,C=null,A.pop(),A.length>0?(m=A[A.length-1],J===!0&&ct.setGlobalState(S.clippingPlanes,m.state.camera)):m=null,_.pop(),_.length>0?x=_[_.length-1]:x=null};function bi(P,k,W,X){if(P.visible===!1)return;if(P.layers.test(k.layers)){if(P.isGroup)W=P.renderOrder;else if(P.isLOD)P.autoUpdate===!0&&P.update(k);else if(P.isLight)m.pushLight(P),P.castShadow&&m.pushShadow(P);else if(P.isSprite){if(!P.frustumCulled||Ht.intersectsSprite(P)){X&&Vt.setFromMatrixPosition(P.matrixWorld).applyMatrix4(vt);const gt=Q.update(P),At=P.material;At.visible&&x.push(P,gt,At,W,Vt.z,null)}}else if((P.isMesh||P.isLine||P.isPoints)&&(!P.frustumCulled||Ht.intersectsObject(P))){const gt=Q.update(P),At=P.material;if(X&&(P.boundingSphere!==void 0?(P.boundingSphere===null&&P.computeBoundingSphere(),Vt.copy(P.boundingSphere.center)):(gt.boundingSphere===null&&gt.computeBoundingSphere(),Vt.copy(gt.boundingSphere.center)),Vt.applyMatrix4(P.matrixWorld).applyMatrix4(vt)),Array.isArray(At)){const Rt=gt.groups;for(let Ot=0,Nt=Rt.length;Ot<Nt;Ot++){const wt=Rt[Ot],he=At[wt.materialIndex];he&&he.visible&&x.push(P,gt,he,W,Vt.z,wt)}}else At.visible&&x.push(P,gt,At,W,Vt.z,null)}}const lt=P.children;for(let gt=0,At=lt.length;gt<At;gt++)bi(lt[gt],k,W,X)}function Va(P,k,W,X){const z=P.opaque,lt=P.transmissive,gt=P.transparent;m.setupLightsView(W),J===!0&&ct.setGlobalState(S.clippingPlanes,W),X&&kt.viewport(y.copy(X)),z.length>0&&Kn(z,k,W),lt.length>0&&Kn(lt,k,W),gt.length>0&&Kn(gt,k,W),kt.buffers.depth.setTest(!0),kt.buffers.depth.setMask(!0),kt.buffers.color.setMask(!0),kt.setPolygonOffset(!1)}function Ba(P,k,W,X){if((W.isScene===!0?W.overrideMaterial:null)!==null)return;m.state.transmissionRenderTarget[X.id]===void 0&&(m.state.transmissionRenderTarget[X.id]=new Ys(1,1,{generateMipmaps:!0,type:te.has("EXT_color_buffer_half_float")||te.has("EXT_color_buffer_float")?Ia:ki,minFilter:Fi,samples:4,stencilBuffer:r,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:me.workingColorSpace}));const lt=m.state.transmissionRenderTarget[X.id],gt=X.viewport||y;lt.setSize(gt.z,gt.w);const At=S.getRenderTarget();S.setRenderTarget(lt),S.getClearColor(R),q=S.getClearAlpha(),q<1&&S.setClearColor(16777215,.5),S.clear(),ue&&Ut.render(W);const Rt=S.toneMapping;S.toneMapping=ls;const Ot=X.viewport;if(X.viewport!==void 0&&(X.viewport=void 0),m.setupLightsView(X),J===!0&&ct.setGlobalState(S.clippingPlanes,X),Kn(P,W,X),U.updateMultisampleRenderTarget(lt),U.updateRenderTargetMipmap(lt),te.has("WEBGL_multisampled_render_to_texture")===!1){let Nt=!1;for(let wt=0,he=k.length;wt<he;wt++){const Se=k[wt],be=Se.object,gn=Se.geometry,de=Se.material,Pt=Se.group;if(de.side===ei&&be.layers.test(X.layers)){const Be=de.side;de.side=Dn,de.needsUpdate=!0,ka(be,W,X,gn,de,Pt),de.side=Be,de.needsUpdate=!0,Nt=!0}}Nt===!0&&(U.updateMultisampleRenderTarget(lt),U.updateRenderTargetMipmap(lt))}S.setRenderTarget(At),S.setClearColor(R,q),Ot!==void 0&&(X.viewport=Ot),S.toneMapping=Rt}function Kn(P,k,W){const X=k.isScene===!0?k.overrideMaterial:null;for(let z=0,lt=P.length;z<lt;z++){const gt=P[z],At=gt.object,Rt=gt.geometry,Ot=X===null?gt.material:X,Nt=gt.group;At.layers.test(W.layers)&&ka(At,k,W,Rt,Ot,Nt)}}function ka(P,k,W,X,z,lt){P.onBeforeRender(S,k,W,X,z,lt),P.modelViewMatrix.multiplyMatrices(W.matrixWorldInverse,P.matrixWorld),P.normalMatrix.getNormalMatrix(P.modelViewMatrix),z.onBeforeRender(S,k,W,X,P,lt),z.transparent===!0&&z.side===ei&&z.forceSinglePass===!1?(z.side=Dn,z.needsUpdate=!0,S.renderBufferDirect(W,k,X,z,P,lt),z.side=yi,z.needsUpdate=!0,S.renderBufferDirect(W,k,X,z,P,lt),z.side=ei):S.renderBufferDirect(W,k,X,z,P,lt),P.onAfterRender(S,k,W,X,z,lt)}function sr(P,k,W){k.isScene!==!0&&(k=Qt);const X=zt.get(P),z=m.state.lights,lt=m.state.shadowsArray,gt=z.state.version,At=ft.getParameters(P,z.state,lt,k,W),Rt=ft.getProgramCacheKey(At);let Ot=X.programs;X.environment=P.isMeshStandardMaterial?k.environment:null,X.fog=k.fog,X.envMap=(P.isMeshStandardMaterial?G:I).get(P.envMap||X.environment),X.envMapRotation=X.environment!==null&&P.envMap===null?k.environmentRotation:P.envMapRotation,Ot===void 0&&(P.addEventListener("dispose",Kt),Ot=new Map,X.programs=Ot);let Nt=Ot.get(Rt);if(Nt!==void 0){if(X.currentProgram===Nt&&X.lightsStateVersion===gt)return xo(P,At),Nt}else At.uniforms=ft.getUniforms(P),P.onBeforeCompile(At,S),Nt=ft.acquireProgram(At,Rt),Ot.set(Rt,Nt),X.uniforms=At.uniforms;const wt=X.uniforms;return(!P.isShaderMaterial&&!P.isRawShaderMaterial||P.clipping===!0)&&(wt.clippingPlanes=ct.uniform),xo(P,At),X.needsLights=ci(P),X.lightsStateVersion=gt,X.needsLights&&(wt.ambientLightColor.value=z.state.ambient,wt.lightProbe.value=z.state.probe,wt.directionalLights.value=z.state.directional,wt.directionalLightShadows.value=z.state.directionalShadow,wt.spotLights.value=z.state.spot,wt.spotLightShadows.value=z.state.spotShadow,wt.rectAreaLights.value=z.state.rectArea,wt.ltc_1.value=z.state.rectAreaLTC1,wt.ltc_2.value=z.state.rectAreaLTC2,wt.pointLights.value=z.state.point,wt.pointLightShadows.value=z.state.pointShadow,wt.hemisphereLights.value=z.state.hemi,wt.directionalShadowMap.value=z.state.directionalShadowMap,wt.directionalShadowMatrix.value=z.state.directionalShadowMatrix,wt.spotShadowMap.value=z.state.spotShadowMap,wt.spotLightMatrix.value=z.state.spotLightMatrix,wt.spotLightMap.value=z.state.spotLightMap,wt.pointShadowMap.value=z.state.pointShadowMap,wt.pointShadowMatrix.value=z.state.pointShadowMatrix),X.currentProgram=Nt,X.uniformsList=null,Nt}function ws(P){if(P.uniformsList===null){const k=P.currentProgram.getUniforms();P.uniformsList=zc.seqWithValue(k.seq,P.uniforms)}return P.uniformsList}function xo(P,k){const W=zt.get(P);W.outputColorSpace=k.outputColorSpace,W.batching=k.batching,W.batchingColor=k.batchingColor,W.instancing=k.instancing,W.instancingColor=k.instancingColor,W.instancingMorph=k.instancingMorph,W.skinning=k.skinning,W.morphTargets=k.morphTargets,W.morphNormals=k.morphNormals,W.morphColors=k.morphColors,W.morphTargetsCount=k.morphTargetsCount,W.numClippingPlanes=k.numClippingPlanes,W.numIntersection=k.numClipIntersection,W.vertexAlphas=k.vertexAlphas,W.vertexTangents=k.vertexTangents,W.toneMapping=k.toneMapping}function Eo(P,k,W,X,z){k.isScene!==!0&&(k=Qt),U.resetTextureUnits();const lt=k.fog,gt=X.isMeshStandardMaterial?k.environment:null,At=M===null?S.outputColorSpace:M.isXRRenderTarget===!0?M.texture.colorSpace:fn,Rt=(X.isMeshStandardMaterial?G:I).get(X.envMap||gt),Ot=X.vertexColors===!0&&!!W.attributes.color&&W.attributes.color.itemSize===4,Nt=!!W.attributes.tangent&&(!!X.normalMap||X.anisotropy>0),wt=!!W.morphAttributes.position,he=!!W.morphAttributes.normal,Se=!!W.morphAttributes.color;let be=ls;X.toneMapped&&(M===null||M.isXRRenderTarget===!0)&&(be=S.toneMapping);const gn=W.morphAttributes.position||W.morphAttributes.normal||W.morphAttributes.color,de=gn!==void 0?gn.length:0,Pt=zt.get(X),Be=m.state.lights;if(J===!0&&(rt===!0||P!==C)){const Fe=P===C&&X.id===w;ct.setState(X,P,Fe)}let fe=!1;X.version===Pt.__version?(Pt.needsLights&&Pt.lightsStateVersion!==Be.state.version||Pt.outputColorSpace!==At||z.isBatchedMesh&&Pt.batching===!1||!z.isBatchedMesh&&Pt.batching===!0||z.isBatchedMesh&&Pt.batchingColor===!0&&z.colorTexture===null||z.isBatchedMesh&&Pt.batchingColor===!1&&z.colorTexture!==null||z.isInstancedMesh&&Pt.instancing===!1||!z.isInstancedMesh&&Pt.instancing===!0||z.isSkinnedMesh&&Pt.skinning===!1||!z.isSkinnedMesh&&Pt.skinning===!0||z.isInstancedMesh&&Pt.instancingColor===!0&&z.instanceColor===null||z.isInstancedMesh&&Pt.instancingColor===!1&&z.instanceColor!==null||z.isInstancedMesh&&Pt.instancingMorph===!0&&z.morphTexture===null||z.isInstancedMesh&&Pt.instancingMorph===!1&&z.morphTexture!==null||Pt.envMap!==Rt||X.fog===!0&&Pt.fog!==lt||Pt.numClippingPlanes!==void 0&&(Pt.numClippingPlanes!==ct.numPlanes||Pt.numIntersection!==ct.numIntersection)||Pt.vertexAlphas!==Ot||Pt.vertexTangents!==Nt||Pt.morphTargets!==wt||Pt.morphNormals!==he||Pt.morphColors!==Se||Pt.toneMapping!==be||Pt.morphTargetsCount!==de)&&(fe=!0):(fe=!0,Pt.__version=X.version);let In=Pt.currentProgram;fe===!0&&(In=sr(X,k,z));let Wi=!1,Mn=!1,or=!1;const Le=In.getUniforms(),li=Pt.uniforms;if(kt.useProgram(In.program)&&(Wi=!0,Mn=!0,or=!0),X.id!==w&&(w=X.id,Mn=!0),Wi||C!==P){re.reverseDepthBuffer?(bt.copy(P.projectionMatrix),Mx(bt),wx(bt),Le.setValue(V,"projectionMatrix",bt)):Le.setValue(V,"projectionMatrix",P.projectionMatrix),Le.setValue(V,"viewMatrix",P.matrixWorldInverse);const Fe=Le.map.cameraPosition;Fe!==void 0&&Fe.setValue(V,Xt.setFromMatrixPosition(P.matrixWorld)),re.logarithmicDepthBuffer&&Le.setValue(V,"logDepthBufFC",2/(Math.log(P.far+1)/Math.LN2)),(X.isMeshPhongMaterial||X.isMeshToonMaterial||X.isMeshLambertMaterial||X.isMeshBasicMaterial||X.isMeshStandardMaterial||X.isShaderMaterial)&&Le.setValue(V,"isOrthographic",P.isOrthographicCamera===!0),C!==P&&(C=P,Mn=!0,or=!0)}if(z.isSkinnedMesh){Le.setOptional(V,z,"bindMatrix"),Le.setOptional(V,z,"bindMatrixInverse");const Fe=z.skeleton;Fe&&(Fe.boneTexture===null&&Fe.computeBoneTexture(),Le.setValue(V,"boneTexture",Fe.boneTexture,U))}z.isBatchedMesh&&(Le.setOptional(V,z,"batchingTexture"),Le.setValue(V,"batchingTexture",z._matricesTexture,U),Le.setOptional(V,z,"batchingIdTexture"),Le.setValue(V,"batchingIdTexture",z._indirectTexture,U),Le.setOptional(V,z,"batchingColorTexture"),z._colorsTexture!==null&&Le.setValue(V,"batchingColorTexture",z._colorsTexture,U));const $n=W.morphAttributes;if(($n.position!==void 0||$n.normal!==void 0||$n.color!==void 0)&&Bt.update(z,W,In),(Mn||Pt.receiveShadow!==z.receiveShadow)&&(Pt.receiveShadow=z.receiveShadow,Le.setValue(V,"receiveShadow",z.receiveShadow)),X.isMeshGouraudMaterial&&X.envMap!==null&&(li.envMap.value=Rt,li.flipEnvMap.value=Rt.isCubeTexture&&Rt.isRenderTargetTexture===!1?-1:1),X.isMeshStandardMaterial&&X.envMap===null&&k.environment!==null&&(li.envMapIntensity.value=k.environmentIntensity),Mn&&(Le.setValue(V,"toneMappingExposure",S.toneMappingExposure),Pt.needsLights&&rr(li,or),lt&&X.fog===!0&&at.refreshFogUniforms(li,lt),at.refreshMaterialUniforms(li,X,ot,j,m.state.transmissionRenderTarget[P.id]),zc.upload(V,ws(Pt),li,U)),X.isShaderMaterial&&X.uniformsNeedUpdate===!0&&(zc.upload(V,ws(Pt),li,U),X.uniformsNeedUpdate=!1),X.isSpriteMaterial&&Le.setValue(V,"center",z.center),Le.setValue(V,"modelViewMatrix",z.modelViewMatrix),Le.setValue(V,"normalMatrix",z.normalMatrix),Le.setValue(V,"modelMatrix",z.matrixWorld),X.isShaderMaterial||X.isRawShaderMaterial){const Fe=X.uniformsGroups;for(let Xi=0,ar=Fe.length;Xi<ar;Xi++){const To=Fe[Xi];B.update(To,In),B.bind(To,In)}}return In}function rr(P,k){P.ambientLightColor.needsUpdate=k,P.lightProbe.needsUpdate=k,P.directionalLights.needsUpdate=k,P.directionalLightShadows.needsUpdate=k,P.pointLights.needsUpdate=k,P.pointLightShadows.needsUpdate=k,P.spotLights.needsUpdate=k,P.spotLightShadows.needsUpdate=k,P.rectAreaLights.needsUpdate=k,P.hemisphereLights.needsUpdate=k}function ci(P){return P.isMeshLambertMaterial||P.isMeshToonMaterial||P.isMeshPhongMaterial||P.isMeshStandardMaterial||P.isShadowMaterial||P.isShaderMaterial&&P.lights===!0}this.getActiveCubeFace=function(){return F},this.getActiveMipmapLevel=function(){return N},this.getRenderTarget=function(){return M},this.setRenderTargetTextures=function(P,k,W){zt.get(P.texture).__webglTexture=k,zt.get(P.depthTexture).__webglTexture=W;const X=zt.get(P);X.__hasExternalTextures=!0,X.__autoAllocateDepthBuffer=W===void 0,X.__autoAllocateDepthBuffer||te.has("WEBGL_multisampled_render_to_texture")===!0&&(console.warn("THREE.WebGLRenderer: Render-to-texture extension was disabled because an external texture was provided"),X.__useRenderToTexture=!1)},this.setRenderTargetFramebuffer=function(P,k){const W=zt.get(P);W.__webglFramebuffer=k,W.__useDefaultFramebuffer=k===void 0},this.setRenderTarget=function(P,k=0,W=0){M=P,F=k,N=W;let X=!0,z=null,lt=!1,gt=!1;if(P){const Rt=zt.get(P);if(Rt.__useDefaultFramebuffer!==void 0)kt.bindFramebuffer(V.FRAMEBUFFER,null),X=!1;else if(Rt.__webglFramebuffer===void 0)U.setupRenderTarget(P);else if(Rt.__hasExternalTextures)U.rebindTextures(P,zt.get(P.texture).__webglTexture,zt.get(P.depthTexture).__webglTexture);else if(P.depthBuffer){const wt=P.depthTexture;if(Rt.__boundDepthTexture!==wt){if(wt!==null&&zt.has(wt)&&(P.width!==wt.image.width||P.height!==wt.image.height))throw new Error("WebGLRenderTarget: Attached DepthTexture is initialized to the incorrect size.");U.setupDepthRenderbuffer(P)}}const Ot=P.texture;(Ot.isData3DTexture||Ot.isDataArrayTexture||Ot.isCompressedArrayTexture)&&(gt=!0);const Nt=zt.get(P).__webglFramebuffer;P.isWebGLCubeRenderTarget?(Array.isArray(Nt[k])?z=Nt[k][W]:z=Nt[k],lt=!0):P.samples>0&&U.useMultisampledRTT(P)===!1?z=zt.get(P).__webglMultisampledFramebuffer:Array.isArray(Nt)?z=Nt[W]:z=Nt,y.copy(P.viewport),E.copy(P.scissor),L=P.scissorTest}else y.copy(Tt).multiplyScalar(ot).floor(),E.copy(Ct).multiplyScalar(ot).floor(),L=$t;if(kt.bindFramebuffer(V.FRAMEBUFFER,z)&&X&&kt.drawBuffers(P,z),kt.viewport(y),kt.scissor(E),kt.setScissorTest(L),lt){const Rt=zt.get(P.texture);V.framebufferTexture2D(V.FRAMEBUFFER,V.COLOR_ATTACHMENT0,V.TEXTURE_CUBE_MAP_POSITIVE_X+k,Rt.__webglTexture,W)}else if(gt){const Rt=zt.get(P.texture),Ot=k||0;V.framebufferTextureLayer(V.FRAMEBUFFER,V.COLOR_ATTACHMENT0,Rt.__webglTexture,W||0,Ot)}w=-1},this.readRenderTargetPixels=function(P,k,W,X,z,lt,gt){if(!(P&&P.isWebGLRenderTarget)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let At=zt.get(P).__webglFramebuffer;if(P.isWebGLCubeRenderTarget&&gt!==void 0&&(At=At[gt]),At){kt.bindFramebuffer(V.FRAMEBUFFER,At);try{const Rt=P.texture,Ot=Rt.format,Nt=Rt.type;if(!re.textureFormatReadable(Ot)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!re.textureTypeReadable(Nt)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}k>=0&&k<=P.width-X&&W>=0&&W<=P.height-z&&V.readPixels(k,W,X,z,qt.convert(Ot),qt.convert(Nt),lt)}finally{const Rt=M!==null?zt.get(M).__webglFramebuffer:null;kt.bindFramebuffer(V.FRAMEBUFFER,Rt)}}},this.readRenderTargetPixelsAsync=async function(P,k,W,X,z,lt,gt){if(!(P&&P.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let At=zt.get(P).__webglFramebuffer;if(P.isWebGLCubeRenderTarget&&gt!==void 0&&(At=At[gt]),At){const Rt=P.texture,Ot=Rt.format,Nt=Rt.type;if(!re.textureFormatReadable(Ot))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!re.textureTypeReadable(Nt))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");if(k>=0&&k<=P.width-X&&W>=0&&W<=P.height-z){kt.bindFramebuffer(V.FRAMEBUFFER,At);const wt=V.createBuffer();V.bindBuffer(V.PIXEL_PACK_BUFFER,wt),V.bufferData(V.PIXEL_PACK_BUFFER,lt.byteLength,V.STREAM_READ),V.readPixels(k,W,X,z,qt.convert(Ot),qt.convert(Nt),0);const he=M!==null?zt.get(M).__webglFramebuffer:null;kt.bindFramebuffer(V.FRAMEBUFFER,he);const Se=V.fenceSync(V.SYNC_GPU_COMMANDS_COMPLETE,0);return V.flush(),await Ax(V,Se,4),V.bindBuffer(V.PIXEL_PACK_BUFFER,wt),V.getBufferSubData(V.PIXEL_PACK_BUFFER,0,lt),V.deleteBuffer(wt),V.deleteSync(Se),lt}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")}},this.copyFramebufferToTexture=function(P,k=null,W=0){P.isTexture!==!0&&(kc("WebGLRenderer: copyFramebufferToTexture function signature has changed."),k=arguments[0]||null,P=arguments[1]);const X=Math.pow(2,-W),z=Math.floor(P.image.width*X),lt=Math.floor(P.image.height*X),gt=k!==null?k.x:0,At=k!==null?k.y:0;U.setTexture2D(P,0),V.copyTexSubImage2D(V.TEXTURE_2D,W,0,0,gt,At,z,lt),kt.unbindTexture()},this.copyTextureToTexture=function(P,k,W=null,X=null,z=0){P.isTexture!==!0&&(kc("WebGLRenderer: copyTextureToTexture function signature has changed."),X=arguments[0]||null,P=arguments[1],k=arguments[2],z=arguments[3]||0,W=null);let lt,gt,At,Rt,Ot,Nt;W!==null?(lt=W.max.x-W.min.x,gt=W.max.y-W.min.y,At=W.min.x,Rt=W.min.y):(lt=P.image.width,gt=P.image.height,At=0,Rt=0),X!==null?(Ot=X.x,Nt=X.y):(Ot=0,Nt=0);const wt=qt.convert(k.format),he=qt.convert(k.type);U.setTexture2D(k,0),V.pixelStorei(V.UNPACK_FLIP_Y_WEBGL,k.flipY),V.pixelStorei(V.UNPACK_PREMULTIPLY_ALPHA_WEBGL,k.premultiplyAlpha),V.pixelStorei(V.UNPACK_ALIGNMENT,k.unpackAlignment);const Se=V.getParameter(V.UNPACK_ROW_LENGTH),be=V.getParameter(V.UNPACK_IMAGE_HEIGHT),gn=V.getParameter(V.UNPACK_SKIP_PIXELS),de=V.getParameter(V.UNPACK_SKIP_ROWS),Pt=V.getParameter(V.UNPACK_SKIP_IMAGES),Be=P.isCompressedTexture?P.mipmaps[z]:P.image;V.pixelStorei(V.UNPACK_ROW_LENGTH,Be.width),V.pixelStorei(V.UNPACK_IMAGE_HEIGHT,Be.height),V.pixelStorei(V.UNPACK_SKIP_PIXELS,At),V.pixelStorei(V.UNPACK_SKIP_ROWS,Rt),P.isDataTexture?V.texSubImage2D(V.TEXTURE_2D,z,Ot,Nt,lt,gt,wt,he,Be.data):P.isCompressedTexture?V.compressedTexSubImage2D(V.TEXTURE_2D,z,Ot,Nt,Be.width,Be.height,wt,Be.data):V.texSubImage2D(V.TEXTURE_2D,z,Ot,Nt,lt,gt,wt,he,Be),V.pixelStorei(V.UNPACK_ROW_LENGTH,Se),V.pixelStorei(V.UNPACK_IMAGE_HEIGHT,be),V.pixelStorei(V.UNPACK_SKIP_PIXELS,gn),V.pixelStorei(V.UNPACK_SKIP_ROWS,de),V.pixelStorei(V.UNPACK_SKIP_IMAGES,Pt),z===0&&k.generateMipmaps&&V.generateMipmap(V.TEXTURE_2D),kt.unbindTexture()},this.copyTextureToTexture3D=function(P,k,W=null,X=null,z=0){P.isTexture!==!0&&(kc("WebGLRenderer: copyTextureToTexture3D function signature has changed."),W=arguments[0]||null,X=arguments[1]||null,P=arguments[2],k=arguments[3],z=arguments[4]||0);let lt,gt,At,Rt,Ot,Nt,wt,he,Se;const be=P.isCompressedTexture?P.mipmaps[z]:P.image;W!==null?(lt=W.max.x-W.min.x,gt=W.max.y-W.min.y,At=W.max.z-W.min.z,Rt=W.min.x,Ot=W.min.y,Nt=W.min.z):(lt=be.width,gt=be.height,At=be.depth,Rt=0,Ot=0,Nt=0),X!==null?(wt=X.x,he=X.y,Se=X.z):(wt=0,he=0,Se=0);const gn=qt.convert(k.format),de=qt.convert(k.type);let Pt;if(k.isData3DTexture)U.setTexture3D(k,0),Pt=V.TEXTURE_3D;else if(k.isDataArrayTexture||k.isCompressedArrayTexture)U.setTexture2DArray(k,0),Pt=V.TEXTURE_2D_ARRAY;else{console.warn("THREE.WebGLRenderer.copyTextureToTexture3D: only supports THREE.DataTexture3D and THREE.DataTexture2DArray.");return}V.pixelStorei(V.UNPACK_FLIP_Y_WEBGL,k.flipY),V.pixelStorei(V.UNPACK_PREMULTIPLY_ALPHA_WEBGL,k.premultiplyAlpha),V.pixelStorei(V.UNPACK_ALIGNMENT,k.unpackAlignment);const Be=V.getParameter(V.UNPACK_ROW_LENGTH),fe=V.getParameter(V.UNPACK_IMAGE_HEIGHT),In=V.getParameter(V.UNPACK_SKIP_PIXELS),Wi=V.getParameter(V.UNPACK_SKIP_ROWS),Mn=V.getParameter(V.UNPACK_SKIP_IMAGES);V.pixelStorei(V.UNPACK_ROW_LENGTH,be.width),V.pixelStorei(V.UNPACK_IMAGE_HEIGHT,be.height),V.pixelStorei(V.UNPACK_SKIP_PIXELS,Rt),V.pixelStorei(V.UNPACK_SKIP_ROWS,Ot),V.pixelStorei(V.UNPACK_SKIP_IMAGES,Nt),P.isDataTexture||P.isData3DTexture?V.texSubImage3D(Pt,z,wt,he,Se,lt,gt,At,gn,de,be.data):k.isCompressedArrayTexture?V.compressedTexSubImage3D(Pt,z,wt,he,Se,lt,gt,At,gn,be.data):V.texSubImage3D(Pt,z,wt,he,Se,lt,gt,At,gn,de,be),V.pixelStorei(V.UNPACK_ROW_LENGTH,Be),V.pixelStorei(V.UNPACK_IMAGE_HEIGHT,fe),V.pixelStorei(V.UNPACK_SKIP_PIXELS,In),V.pixelStorei(V.UNPACK_SKIP_ROWS,Wi),V.pixelStorei(V.UNPACK_SKIP_IMAGES,Mn),z===0&&k.generateMipmaps&&V.generateMipmap(Pt),kt.unbindTexture()},this.initRenderTarget=function(P){zt.get(P).__webglFramebuffer===void 0&&U.setupRenderTarget(P)},this.initTexture=function(P){P.isCubeTexture?U.setTextureCube(P,0):P.isData3DTexture?U.setTexture3D(P,0):P.isDataArrayTexture||P.isCompressedArrayTexture?U.setTexture2DArray(P,0):U.setTexture2D(P,0),kt.unbindTexture()},this.resetState=function(){F=0,N=0,M=null,kt.reset(),Ee.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return Vi}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(t){this._outputColorSpace=t;const e=this.getContext();e.drawingBufferColorSpace=t===Md?"display-p3":"srgb",e.unpackColorSpace=me.workingColorSpace===Ml?"display-p3":"srgb"}}class A_{constructor(t,e=1,n=1e3){this.isFog=!0,this.name="",this.color=new It(t),this.near=e,this.far=n}clone(){return new A_(this.color,this.near,this.far)}toJSON(){return{type:"Fog",name:this.name,color:this.color.getHex(),near:this.near,far:this.far}}}class z2 extends Me{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new ai,this.environmentIntensity=1,this.environmentRotation=new ai,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(t,e){return super.copy(t,e),t.background!==null&&(this.background=t.background.clone()),t.environment!==null&&(this.environment=t.environment.clone()),t.fog!==null&&(this.fog=t.fog.clone()),this.backgroundBlurriness=t.backgroundBlurriness,this.backgroundIntensity=t.backgroundIntensity,this.backgroundRotation.copy(t.backgroundRotation),this.environmentIntensity=t.environmentIntensity,this.environmentRotation.copy(t.environmentRotation),t.overrideMaterial!==null&&(this.overrideMaterial=t.overrideMaterial.clone()),this.matrixAutoUpdate=t.matrixAutoUpdate,this}toJSON(t){const e=super.toJSON(t);return this.fog!==null&&(e.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(e.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(e.object.backgroundIntensity=this.backgroundIntensity),e.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(e.object.environmentIntensity=this.environmentIntensity),e.object.environmentRotation=this.environmentRotation.toArray(),e}}class M_{constructor(t,e){this.isInterleavedBuffer=!0,this.array=t,this.stride=e,this.count=t!==void 0?t.length/e:0,this.usage=Uh,this.updateRanges=[],this.version=0,this.uuid=qn()}onUploadCallback(){}set needsUpdate(t){t===!0&&this.version++}setUsage(t){return this.usage=t,this}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}copy(t){return this.array=new t.array.constructor(t.array),this.count=t.count,this.stride=t.stride,this.usage=t.usage,this}copyAt(t,e,n){t*=this.stride,n*=e.stride;for(let s=0,r=this.stride;s<r;s++)this.array[t+s]=e.array[n+s];return this}set(t,e=0){return this.array.set(t,e),this}clone(t){t.arrayBuffers===void 0&&(t.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=qn()),t.arrayBuffers[this.array.buffer._uuid]===void 0&&(t.arrayBuffers[this.array.buffer._uuid]=this.array.slice(0).buffer);const e=new this.array.constructor(t.arrayBuffers[this.array.buffer._uuid]),n=new this.constructor(e,this.stride);return n.setUsage(this.usage),n}onUpload(t){return this.onUploadCallback=t,this}toJSON(t){return t.arrayBuffers===void 0&&(t.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=qn()),t.arrayBuffers[this.array.buffer._uuid]===void 0&&(t.arrayBuffers[this.array.buffer._uuid]=Array.from(new Uint32Array(this.array.buffer))),{uuid:this.uuid,buffer:this.array.buffer._uuid,type:this.array.constructor.name,stride:this.stride}}}const wn=new O;class fa{constructor(t,e,n,s=!1){this.isInterleavedBufferAttribute=!0,this.name="",this.data=t,this.itemSize=e,this.offset=n,this.normalized=s}get count(){return this.data.count}get array(){return this.data.array}set needsUpdate(t){this.data.needsUpdate=t}applyMatrix4(t){for(let e=0,n=this.data.count;e<n;e++)wn.fromBufferAttribute(this,e),wn.applyMatrix4(t),this.setXYZ(e,wn.x,wn.y,wn.z);return this}applyNormalMatrix(t){for(let e=0,n=this.count;e<n;e++)wn.fromBufferAttribute(this,e),wn.applyNormalMatrix(t),this.setXYZ(e,wn.x,wn.y,wn.z);return this}transformDirection(t){for(let e=0,n=this.count;e<n;e++)wn.fromBufferAttribute(this,e),wn.transformDirection(t),this.setXYZ(e,wn.x,wn.y,wn.z);return this}getComponent(t,e){let n=this.array[t*this.data.stride+this.offset+e];return this.normalized&&(n=ni(n,this.array)),n}setComponent(t,e,n){return this.normalized&&(n=xe(n,this.array)),this.data.array[t*this.data.stride+this.offset+e]=n,this}setX(t,e){return this.normalized&&(e=xe(e,this.array)),this.data.array[t*this.data.stride+this.offset]=e,this}setY(t,e){return this.normalized&&(e=xe(e,this.array)),this.data.array[t*this.data.stride+this.offset+1]=e,this}setZ(t,e){return this.normalized&&(e=xe(e,this.array)),this.data.array[t*this.data.stride+this.offset+2]=e,this}setW(t,e){return this.normalized&&(e=xe(e,this.array)),this.data.array[t*this.data.stride+this.offset+3]=e,this}getX(t){let e=this.data.array[t*this.data.stride+this.offset];return this.normalized&&(e=ni(e,this.array)),e}getY(t){let e=this.data.array[t*this.data.stride+this.offset+1];return this.normalized&&(e=ni(e,this.array)),e}getZ(t){let e=this.data.array[t*this.data.stride+this.offset+2];return this.normalized&&(e=ni(e,this.array)),e}getW(t){let e=this.data.array[t*this.data.stride+this.offset+3];return this.normalized&&(e=ni(e,this.array)),e}setXY(t,e,n){return t=t*this.data.stride+this.offset,this.normalized&&(e=xe(e,this.array),n=xe(n,this.array)),this.data.array[t+0]=e,this.data.array[t+1]=n,this}setXYZ(t,e,n,s){return t=t*this.data.stride+this.offset,this.normalized&&(e=xe(e,this.array),n=xe(n,this.array),s=xe(s,this.array)),this.data.array[t+0]=e,this.data.array[t+1]=n,this.data.array[t+2]=s,this}setXYZW(t,e,n,s,r){return t=t*this.data.stride+this.offset,this.normalized&&(e=xe(e,this.array),n=xe(n,this.array),s=xe(s,this.array),r=xe(r,this.array)),this.data.array[t+0]=e,this.data.array[t+1]=n,this.data.array[t+2]=s,this.data.array[t+3]=r,this}clone(t){if(t===void 0){console.log("THREE.InterleavedBufferAttribute.clone(): Cloning an interleaved buffer attribute will de-interleave buffer data.");const e=[];for(let n=0;n<this.count;n++){const s=n*this.data.stride+this.offset;for(let r=0;r<this.itemSize;r++)e.push(this.data.array[s+r])}return new An(new this.array.constructor(e),this.itemSize,this.normalized)}else return t.interleavedBuffers===void 0&&(t.interleavedBuffers={}),t.interleavedBuffers[this.data.uuid]===void 0&&(t.interleavedBuffers[this.data.uuid]=this.data.clone(t)),new fa(t.interleavedBuffers[this.data.uuid],this.itemSize,this.offset,this.normalized)}toJSON(t){if(t===void 0){console.log("THREE.InterleavedBufferAttribute.toJSON(): Serializing an interleaved buffer attribute will de-interleave buffer data.");const e=[];for(let n=0;n<this.count;n++){const s=n*this.data.stride+this.offset;for(let r=0;r<this.itemSize;r++)e.push(this.data.array[s+r])}return{itemSize:this.itemSize,type:this.array.constructor.name,array:e,normalized:this.normalized}}else return t.interleavedBuffers===void 0&&(t.interleavedBuffers={}),t.interleavedBuffers[this.data.uuid]===void 0&&(t.interleavedBuffers[this.data.uuid]=this.data.toJSON(t)),{isInterleavedBufferAttribute:!0,itemSize:this.itemSize,data:this.data.uuid,offset:this.offset,normalized:this.normalized}}}class OM extends jn{constructor(t){super(),this.isSpriteMaterial=!0,this.type="SpriteMaterial",this.color=new It(16777215),this.map=null,this.alphaMap=null,this.rotation=0,this.sizeAttenuation=!0,this.transparent=!0,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.alphaMap=t.alphaMap,this.rotation=t.rotation,this.sizeAttenuation=t.sizeAttenuation,this.fog=t.fog,this}}let Mr;const Uo=new O,wr=new O,br=new O,Rr=new dt,Oo=new dt,w_=new Gt,gc=new O,Fo=new O,_c=new O,jp=new dt,Mu=new dt,Kp=new dt;class H2 extends Me{constructor(t=new OM){if(super(),this.isSprite=!0,this.type="Sprite",Mr===void 0){Mr=new mn;const e=new Float32Array([-.5,-.5,0,0,0,.5,-.5,0,1,0,.5,.5,0,1,1,-.5,.5,0,0,1]),n=new M_(e,5);Mr.setIndex([0,1,2,0,2,3]),Mr.setAttribute("position",new fa(n,3,0,!1)),Mr.setAttribute("uv",new fa(n,2,3,!1))}this.geometry=Mr,this.material=t,this.center=new dt(.5,.5)}raycast(t,e){t.camera===null&&console.error('THREE.Sprite: "Raycaster.camera" needs to be set in order to raycast against sprites.'),wr.setFromMatrixScale(this.matrixWorld),w_.copy(t.camera.matrixWorld),this.modelViewMatrix.multiplyMatrices(t.camera.matrixWorldInverse,this.matrixWorld),br.setFromMatrixPosition(this.modelViewMatrix),t.camera.isPerspectiveCamera&&this.material.sizeAttenuation===!1&&wr.multiplyScalar(-br.z);const n=this.material.rotation;let s,r;n!==0&&(r=Math.cos(n),s=Math.sin(n));const o=this.center;vc(gc.set(-.5,-.5,0),br,o,wr,s,r),vc(Fo.set(.5,-.5,0),br,o,wr,s,r),vc(_c.set(.5,.5,0),br,o,wr,s,r),jp.set(0,0),Mu.set(1,0),Kp.set(1,1);let a=t.ray.intersectTriangle(gc,Fo,_c,!1,Uo);if(a===null&&(vc(Fo.set(-.5,.5,0),br,o,wr,s,r),Mu.set(0,1),a=t.ray.intersectTriangle(gc,_c,Fo,!1,Uo),a===null))return;const c=t.ray.origin.distanceTo(Uo);c<t.near||c>t.far||e.push({distance:c,point:Uo.clone(),uv:Hn.getInterpolation(Uo,gc,Fo,_c,jp,Mu,Kp,new dt),face:null,object:this})}copy(t,e){return super.copy(t,e),t.center!==void 0&&this.center.copy(t.center),this.material=t.material,this}}function vc(i,t,e,n,s,r){Rr.subVectors(i,e).addScalar(.5).multiply(n),s!==void 0?(Oo.x=r*Rr.x-s*Rr.y,Oo.y=s*Rr.x+r*Rr.y):Oo.copy(Rr),i.copy(t),i.x+=Oo.x,i.y+=Oo.y,i.applyMatrix4(w_)}const $p=new O,Yp=new ge,Jp=new ge,FM=new O,Zp=new Gt,yc=new O,wu=new Si,Qp=new Gt,bu=new Ca;class VM extends ve{constructor(t,e){super(t,e),this.isSkinnedMesh=!0,this.type="SkinnedMesh",this.bindMode=np,this.bindMatrix=new Gt,this.bindMatrixInverse=new Gt,this.boundingBox=null,this.boundingSphere=null}computeBoundingBox(){const t=this.geometry;this.boundingBox===null&&(this.boundingBox=new Ti),this.boundingBox.makeEmpty();const e=t.getAttribute("position");for(let n=0;n<e.count;n++)this.getVertexPosition(n,yc),this.boundingBox.expandByPoint(yc)}computeBoundingSphere(){const t=this.geometry;this.boundingSphere===null&&(this.boundingSphere=new Si),this.boundingSphere.makeEmpty();const e=t.getAttribute("position");for(let n=0;n<e.count;n++)this.getVertexPosition(n,yc),this.boundingSphere.expandByPoint(yc)}copy(t,e){return super.copy(t,e),this.bindMode=t.bindMode,this.bindMatrix.copy(t.bindMatrix),this.bindMatrixInverse.copy(t.bindMatrixInverse),this.skeleton=t.skeleton,t.boundingBox!==null&&(this.boundingBox=t.boundingBox.clone()),t.boundingSphere!==null&&(this.boundingSphere=t.boundingSphere.clone()),this}raycast(t,e){const n=this.material,s=this.matrixWorld;n!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),wu.copy(this.boundingSphere),wu.applyMatrix4(s),t.ray.intersectsSphere(wu)!==!1&&(Qp.copy(s).invert(),bu.copy(t.ray).applyMatrix4(Qp),!(this.boundingBox!==null&&bu.intersectsBox(this.boundingBox)===!1)&&this._computeIntersections(t,e,bu)))}getVertexPosition(t,e){return super.getVertexPosition(t,e),this.applyBoneTransform(t,e),e}bind(t,e){this.skeleton=t,e===void 0&&(this.updateMatrixWorld(!0),this.skeleton.calculateInverses(),e=this.matrixWorld),this.bindMatrix.copy(e),this.bindMatrixInverse.copy(e).invert()}pose(){this.skeleton.pose()}normalizeSkinWeights(){const t=new ge,e=this.geometry.attributes.skinWeight;for(let n=0,s=e.count;n<s;n++){t.fromBufferAttribute(e,n);const r=1/t.manhattanLength();r!==1/0?t.multiplyScalar(r):t.set(1,0,0,0),e.setXYZW(n,t.x,t.y,t.z,t.w)}}updateMatrixWorld(t){super.updateMatrixWorld(t),this.bindMode===np?this.bindMatrixInverse.copy(this.matrixWorld).invert():this.bindMode===Wy?this.bindMatrixInverse.copy(this.bindMatrix).invert():console.warn("THREE.SkinnedMesh: Unrecognized bindMode: "+this.bindMode)}applyBoneTransform(t,e){const n=this.skeleton,s=this.geometry;Yp.fromBufferAttribute(s.attributes.skinIndex,t),Jp.fromBufferAttribute(s.attributes.skinWeight,t),$p.copy(e).applyMatrix4(this.bindMatrix),e.set(0,0,0);for(let r=0;r<4;r++){const o=Jp.getComponent(r);if(o!==0){const a=Yp.getComponent(r);Zp.multiplyMatrices(n.bones[a].matrixWorld,n.boneInverses[a]),e.addScaledVector(FM.copy($p).applyMatrix4(Zp),o)}}return e.applyMatrix4(this.bindMatrixInverse)}}class b_ extends Me{constructor(){super(),this.isBone=!0,this.type="Bone"}}class R_ extends Ze{constructor(t=null,e=1,n=1,s,r,o,a,c,l=Rn,h=Rn,d,f){super(null,o,a,c,l,h,s,r,d,f),this.isDataTexture=!0,this.image={data:t,width:e,height:n},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}const tm=new Gt,BM=new Gt;class Pd{constructor(t=[],e=[]){this.uuid=qn(),this.bones=t.slice(0),this.boneInverses=e,this.boneMatrices=null,this.boneTexture=null,this.init()}init(){const t=this.bones,e=this.boneInverses;if(this.boneMatrices=new Float32Array(t.length*16),e.length===0)this.calculateInverses();else if(t.length!==e.length){console.warn("THREE.Skeleton: Number of inverse bone matrices does not match amount of bones."),this.boneInverses=[];for(let n=0,s=this.bones.length;n<s;n++)this.boneInverses.push(new Gt)}}calculateInverses(){this.boneInverses.length=0;for(let t=0,e=this.bones.length;t<e;t++){const n=new Gt;this.bones[t]&&n.copy(this.bones[t].matrixWorld).invert(),this.boneInverses.push(n)}}pose(){for(let t=0,e=this.bones.length;t<e;t++){const n=this.bones[t];n&&n.matrixWorld.copy(this.boneInverses[t]).invert()}for(let t=0,e=this.bones.length;t<e;t++){const n=this.bones[t];n&&(n.parent&&n.parent.isBone?(n.matrix.copy(n.parent.matrixWorld).invert(),n.matrix.multiply(n.matrixWorld)):n.matrix.copy(n.matrixWorld),n.matrix.decompose(n.position,n.quaternion,n.scale))}}update(){const t=this.bones,e=this.boneInverses,n=this.boneMatrices,s=this.boneTexture;for(let r=0,o=t.length;r<o;r++){const a=t[r]?t[r].matrixWorld:BM;tm.multiplyMatrices(a,e[r]),tm.toArray(n,r*16)}s!==null&&(s.needsUpdate=!0)}clone(){return new Pd(this.bones,this.boneInverses)}computeBoneTexture(){let t=Math.sqrt(this.bones.length*4);t=Math.ceil(t/4)*4,t=Math.max(t,4);const e=new Float32Array(t*t*4);e.set(this.boneMatrices);const n=new R_(e,t,t,Xn,si);return n.needsUpdate=!0,this.boneMatrices=e,this.boneTexture=n,this}getBoneByName(t){for(let e=0,n=this.bones.length;e<n;e++){const s=this.bones[e];if(s.name===t)return s}}dispose(){this.boneTexture!==null&&(this.boneTexture.dispose(),this.boneTexture=null)}fromJSON(t,e){this.uuid=t.uuid;for(let n=0,s=t.bones.length;n<s;n++){const r=t.bones[n];let o=e[r];o===void 0&&(console.warn("THREE.Skeleton: No bone found with UUID:",r),o=new b_),this.bones.push(o),this.boneInverses.push(new Gt().fromArray(t.boneInverses[n]))}return this.init(),this}toJSON(){const t={metadata:{version:4.6,type:"Skeleton",generator:"Skeleton.toJSON"},bones:[],boneInverses:[]};t.uuid=this.uuid;const e=this.bones,n=this.boneInverses;for(let s=0,r=e.length;s<r;s++){const o=e[s];t.bones.push(o.uuid);const a=n[s];t.boneInverses.push(a.toArray())}return t}}class Fh extends An{constructor(t,e,n,s=1){super(t,e,n),this.isInstancedBufferAttribute=!0,this.meshPerAttribute=s}copy(t){return super.copy(t),this.meshPerAttribute=t.meshPerAttribute,this}toJSON(){const t=super.toJSON();return t.meshPerAttribute=this.meshPerAttribute,t.isInstancedBufferAttribute=!0,t}}const Ir=new Gt,em=new Gt,xc=[],nm=new Ti,kM=new Gt,Vo=new ve,Bo=new Si;class Qo extends ve{constructor(t,e,n){super(t,e),this.isInstancedMesh=!0,this.instanceMatrix=new Fh(new Float32Array(n*16),16),this.instanceColor=null,this.morphTexture=null,this.count=n,this.boundingBox=null,this.boundingSphere=null;for(let s=0;s<n;s++)this.setMatrixAt(s,kM)}computeBoundingBox(){const t=this.geometry,e=this.count;this.boundingBox===null&&(this.boundingBox=new Ti),t.boundingBox===null&&t.computeBoundingBox(),this.boundingBox.makeEmpty();for(let n=0;n<e;n++)this.getMatrixAt(n,Ir),nm.copy(t.boundingBox).applyMatrix4(Ir),this.boundingBox.union(nm)}computeBoundingSphere(){const t=this.geometry,e=this.count;this.boundingSphere===null&&(this.boundingSphere=new Si),t.boundingSphere===null&&t.computeBoundingSphere(),this.boundingSphere.makeEmpty();for(let n=0;n<e;n++)this.getMatrixAt(n,Ir),Bo.copy(t.boundingSphere).applyMatrix4(Ir),this.boundingSphere.union(Bo)}copy(t,e){return super.copy(t,e),this.instanceMatrix.copy(t.instanceMatrix),t.morphTexture!==null&&(this.morphTexture=t.morphTexture.clone()),t.instanceColor!==null&&(this.instanceColor=t.instanceColor.clone()),this.count=t.count,t.boundingBox!==null&&(this.boundingBox=t.boundingBox.clone()),t.boundingSphere!==null&&(this.boundingSphere=t.boundingSphere.clone()),this}getColorAt(t,e){e.fromArray(this.instanceColor.array,t*3)}getMatrixAt(t,e){e.fromArray(this.instanceMatrix.array,t*16)}getMorphAt(t,e){const n=e.morphTargetInfluences,s=this.morphTexture.source.data.data,r=n.length+1,o=t*r+1;for(let a=0;a<n.length;a++)n[a]=s[o+a]}raycast(t,e){const n=this.matrixWorld,s=this.count;if(Vo.geometry=this.geometry,Vo.material=this.material,Vo.material!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),Bo.copy(this.boundingSphere),Bo.applyMatrix4(n),t.ray.intersectsSphere(Bo)!==!1))for(let r=0;r<s;r++){this.getMatrixAt(r,Ir),em.multiplyMatrices(n,Ir),Vo.matrixWorld=em,Vo.raycast(t,xc);for(let o=0,a=xc.length;o<a;o++){const c=xc[o];c.instanceId=r,c.object=this,e.push(c)}xc.length=0}}setColorAt(t,e){this.instanceColor===null&&(this.instanceColor=new Fh(new Float32Array(this.instanceMatrix.count*3).fill(1),3)),e.toArray(this.instanceColor.array,t*3)}setMatrixAt(t,e){e.toArray(this.instanceMatrix.array,t*16)}setMorphAt(t,e){const n=e.morphTargetInfluences,s=n.length+1;this.morphTexture===null&&(this.morphTexture=new R_(new Float32Array(s*this.count),s,this.count,yd,si));const r=this.morphTexture.source.data.data;let o=0;for(let l=0;l<n.length;l++)o+=n[l];const a=this.geometry.morphTargetsRelative?1:1-o,c=s*t;r[c]=a,r.set(n,c+1)}updateMorphTargets(){}dispose(){return this.dispatchEvent({type:"dispose"}),this.morphTexture!==null&&(this.morphTexture.dispose(),this.morphTexture=null),this}}class I_ extends jn{constructor(t){super(),this.isLineBasicMaterial=!0,this.type="LineBasicMaterial",this.color=new It(16777215),this.map=null,this.linewidth=1,this.linecap="round",this.linejoin="round",this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.linewidth=t.linewidth,this.linecap=t.linecap,this.linejoin=t.linejoin,this.fog=t.fog,this}}const nl=new O,il=new O,im=new Gt,ko=new Ca,Ec=new Si,Ru=new O,sm=new O;class Dd extends Me{constructor(t=new mn,e=new I_){super(),this.isLine=!0,this.type="Line",this.geometry=t,this.material=e,this.updateMorphTargets()}copy(t,e){return super.copy(t,e),this.material=Array.isArray(t.material)?t.material.slice():t.material,this.geometry=t.geometry,this}computeLineDistances(){const t=this.geometry;if(t.index===null){const e=t.attributes.position,n=[0];for(let s=1,r=e.count;s<r;s++)nl.fromBufferAttribute(e,s-1),il.fromBufferAttribute(e,s),n[s]=n[s-1],n[s]+=nl.distanceTo(il);t.setAttribute("lineDistance",new we(n,1))}else console.warn("THREE.Line.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}raycast(t,e){const n=this.geometry,s=this.matrixWorld,r=t.params.Line.threshold,o=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),Ec.copy(n.boundingSphere),Ec.applyMatrix4(s),Ec.radius+=r,t.ray.intersectsSphere(Ec)===!1)return;im.copy(s).invert(),ko.copy(t.ray).applyMatrix4(im);const a=r/((this.scale.x+this.scale.y+this.scale.z)/3),c=a*a,l=this.isLineSegments?2:1,h=n.index,f=n.attributes.position;if(h!==null){const p=Math.max(0,o.start),v=Math.min(h.count,o.start+o.count);for(let x=p,m=v-1;x<m;x+=l){const _=h.getX(x),A=h.getX(x+1),S=Tc(this,t,ko,c,_,A);S&&e.push(S)}if(this.isLineLoop){const x=h.getX(v-1),m=h.getX(p),_=Tc(this,t,ko,c,x,m);_&&e.push(_)}}else{const p=Math.max(0,o.start),v=Math.min(f.count,o.start+o.count);for(let x=p,m=v-1;x<m;x+=l){const _=Tc(this,t,ko,c,x,x+1);_&&e.push(_)}if(this.isLineLoop){const x=Tc(this,t,ko,c,v-1,p);x&&e.push(x)}}}updateMorphTargets(){const e=this.geometry.morphAttributes,n=Object.keys(e);if(n.length>0){const s=e[n[0]];if(s!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,o=s.length;r<o;r++){const a=s[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=r}}}}}function Tc(i,t,e,n,s,r){const o=i.geometry.attributes.position;if(nl.fromBufferAttribute(o,s),il.fromBufferAttribute(o,r),e.distanceSqToSegment(nl,il,Ru,sm)>n)return;Ru.applyMatrix4(i.matrixWorld);const c=t.ray.origin.distanceTo(Ru);if(!(c<t.near||c>t.far))return{distance:c,point:sm.clone().applyMatrix4(i.matrixWorld),index:s,face:null,faceIndex:null,barycoord:null,object:i}}const rm=new O,om=new O;class zM extends Dd{constructor(t,e){super(t,e),this.isLineSegments=!0,this.type="LineSegments"}computeLineDistances(){const t=this.geometry;if(t.index===null){const e=t.attributes.position,n=[];for(let s=0,r=e.count;s<r;s+=2)rm.fromBufferAttribute(e,s),om.fromBufferAttribute(e,s+1),n[s]=s===0?0:n[s-1],n[s+1]=n[s]+rm.distanceTo(om);t.setAttribute("lineDistance",new we(n,1))}else console.warn("THREE.LineSegments.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}}class HM extends Dd{constructor(t,e){super(t,e),this.isLineLoop=!0,this.type="LineLoop"}}class C_ extends jn{constructor(t){super(),this.isPointsMaterial=!0,this.type="PointsMaterial",this.color=new It(16777215),this.map=null,this.alphaMap=null,this.size=1,this.sizeAttenuation=!0,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.alphaMap=t.alphaMap,this.size=t.size,this.sizeAttenuation=t.sizeAttenuation,this.fog=t.fog,this}}const am=new Gt,Vh=new Ca,Sc=new Si,Ac=new O;class GM extends Me{constructor(t=new mn,e=new C_){super(),this.isPoints=!0,this.type="Points",this.geometry=t,this.material=e,this.updateMorphTargets()}copy(t,e){return super.copy(t,e),this.material=Array.isArray(t.material)?t.material.slice():t.material,this.geometry=t.geometry,this}raycast(t,e){const n=this.geometry,s=this.matrixWorld,r=t.params.Points.threshold,o=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),Sc.copy(n.boundingSphere),Sc.applyMatrix4(s),Sc.radius+=r,t.ray.intersectsSphere(Sc)===!1)return;am.copy(s).invert(),Vh.copy(t.ray).applyMatrix4(am);const a=r/((this.scale.x+this.scale.y+this.scale.z)/3),c=a*a,l=n.index,d=n.attributes.position;if(l!==null){const f=Math.max(0,o.start),p=Math.min(l.count,o.start+o.count);for(let v=f,x=p;v<x;v++){const m=l.getX(v);Ac.fromBufferAttribute(d,m),cm(Ac,m,c,s,t,e,this)}}else{const f=Math.max(0,o.start),p=Math.min(d.count,o.start+o.count);for(let v=f,x=p;v<x;v++)Ac.fromBufferAttribute(d,v),cm(Ac,v,c,s,t,e,this)}}updateMorphTargets(){const e=this.geometry.morphAttributes,n=Object.keys(e);if(n.length>0){const s=e[n[0]];if(s!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,o=s.length;r<o;r++){const a=s[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=r}}}}}function cm(i,t,e,n,s,r,o){const a=Vh.distanceSqToPoint(i);if(a<e){const c=new O;Vh.closestPointToPoint(i,c),c.applyMatrix4(n);const l=s.ray.origin.distanceTo(c);if(l<s.near||l>s.far)return;r.push({distance:l,distanceToRay:Math.sqrt(a),point:c,index:t,face:null,faceIndex:null,barycoord:null,object:o})}}class WM extends Ze{constructor(t,e,n,s,r,o,a,c,l){super(t,e,n,s,r,o,a,c,l),this.isCanvasTexture=!0,this.needsUpdate=!0}}class Ai{constructor(){this.type="Curve",this.arcLengthDivisions=200}getPoint(){return console.warn("THREE.Curve: .getPoint() not implemented."),null}getPointAt(t,e){const n=this.getUtoTmapping(t);return this.getPoint(n,e)}getPoints(t=5){const e=[];for(let n=0;n<=t;n++)e.push(this.getPoint(n/t));return e}getSpacedPoints(t=5){const e=[];for(let n=0;n<=t;n++)e.push(this.getPointAt(n/t));return e}getLength(){const t=this.getLengths();return t[t.length-1]}getLengths(t=this.arcLengthDivisions){if(this.cacheArcLengths&&this.cacheArcLengths.length===t+1&&!this.needsUpdate)return this.cacheArcLengths;this.needsUpdate=!1;const e=[];let n,s=this.getPoint(0),r=0;e.push(0);for(let o=1;o<=t;o++)n=this.getPoint(o/t),r+=n.distanceTo(s),e.push(r),s=n;return this.cacheArcLengths=e,e}updateArcLengths(){this.needsUpdate=!0,this.getLengths()}getUtoTmapping(t,e){const n=this.getLengths();let s=0;const r=n.length;let o;e?o=e:o=t*n[r-1];let a=0,c=r-1,l;for(;a<=c;)if(s=Math.floor(a+(c-a)/2),l=n[s]-o,l<0)a=s+1;else if(l>0)c=s-1;else{c=s;break}if(s=c,n[s]===o)return s/(r-1);const h=n[s],f=n[s+1]-h,p=(o-h)/f;return(s+p)/(r-1)}getTangent(t,e){let s=t-1e-4,r=t+1e-4;s<0&&(s=0),r>1&&(r=1);const o=this.getPoint(s),a=this.getPoint(r),c=e||(o.isVector2?new dt:new O);return c.copy(a).sub(o).normalize(),c}getTangentAt(t,e){const n=this.getUtoTmapping(t);return this.getTangent(n,e)}computeFrenetFrames(t,e){const n=new O,s=[],r=[],o=[],a=new O,c=new Gt;for(let p=0;p<=t;p++){const v=p/t;s[p]=this.getTangentAt(v,new O)}r[0]=new O,o[0]=new O;let l=Number.MAX_VALUE;const h=Math.abs(s[0].x),d=Math.abs(s[0].y),f=Math.abs(s[0].z);h<=l&&(l=h,n.set(1,0,0)),d<=l&&(l=d,n.set(0,1,0)),f<=l&&n.set(0,0,1),a.crossVectors(s[0],n).normalize(),r[0].crossVectors(s[0],a),o[0].crossVectors(s[0],r[0]);for(let p=1;p<=t;p++){if(r[p]=r[p-1].clone(),o[p]=o[p-1].clone(),a.crossVectors(s[p-1],s[p]),a.length()>Number.EPSILON){a.normalize();const v=Math.acos($e(s[p-1].dot(s[p]),-1,1));r[p].applyMatrix4(c.makeRotationAxis(a,v))}o[p].crossVectors(s[p],r[p])}if(e===!0){let p=Math.acos($e(r[0].dot(r[t]),-1,1));p/=t,s[0].dot(a.crossVectors(r[0],r[t]))>0&&(p=-p);for(let v=1;v<=t;v++)r[v].applyMatrix4(c.makeRotationAxis(s[v],p*v)),o[v].crossVectors(s[v],r[v])}return{tangents:s,normals:r,binormals:o}}clone(){return new this.constructor().copy(this)}copy(t){return this.arcLengthDivisions=t.arcLengthDivisions,this}toJSON(){const t={metadata:{version:4.6,type:"Curve",generator:"Curve.toJSON"}};return t.arcLengthDivisions=this.arcLengthDivisions,t.type=this.type,t}fromJSON(t){return this.arcLengthDivisions=t.arcLengthDivisions,this}}class Ld extends Ai{constructor(t=0,e=0,n=1,s=1,r=0,o=Math.PI*2,a=!1,c=0){super(),this.isEllipseCurve=!0,this.type="EllipseCurve",this.aX=t,this.aY=e,this.xRadius=n,this.yRadius=s,this.aStartAngle=r,this.aEndAngle=o,this.aClockwise=a,this.aRotation=c}getPoint(t,e=new dt){const n=e,s=Math.PI*2;let r=this.aEndAngle-this.aStartAngle;const o=Math.abs(r)<Number.EPSILON;for(;r<0;)r+=s;for(;r>s;)r-=s;r<Number.EPSILON&&(o?r=0:r=s),this.aClockwise===!0&&!o&&(r===s?r=-s:r=r-s);const a=this.aStartAngle+t*r;let c=this.aX+this.xRadius*Math.cos(a),l=this.aY+this.yRadius*Math.sin(a);if(this.aRotation!==0){const h=Math.cos(this.aRotation),d=Math.sin(this.aRotation),f=c-this.aX,p=l-this.aY;c=f*h-p*d+this.aX,l=f*d+p*h+this.aY}return n.set(c,l)}copy(t){return super.copy(t),this.aX=t.aX,this.aY=t.aY,this.xRadius=t.xRadius,this.yRadius=t.yRadius,this.aStartAngle=t.aStartAngle,this.aEndAngle=t.aEndAngle,this.aClockwise=t.aClockwise,this.aRotation=t.aRotation,this}toJSON(){const t=super.toJSON();return t.aX=this.aX,t.aY=this.aY,t.xRadius=this.xRadius,t.yRadius=this.yRadius,t.aStartAngle=this.aStartAngle,t.aEndAngle=this.aEndAngle,t.aClockwise=this.aClockwise,t.aRotation=this.aRotation,t}fromJSON(t){return super.fromJSON(t),this.aX=t.aX,this.aY=t.aY,this.xRadius=t.xRadius,this.yRadius=t.yRadius,this.aStartAngle=t.aStartAngle,this.aEndAngle=t.aEndAngle,this.aClockwise=t.aClockwise,this.aRotation=t.aRotation,this}}class XM extends Ld{constructor(t,e,n,s,r,o){super(t,e,n,n,s,r,o),this.isArcCurve=!0,this.type="ArcCurve"}}function Nd(){let i=0,t=0,e=0,n=0;function s(r,o,a,c){i=r,t=a,e=-3*r+3*o-2*a-c,n=2*r-2*o+a+c}return{initCatmullRom:function(r,o,a,c,l){s(o,a,l*(a-r),l*(c-o))},initNonuniformCatmullRom:function(r,o,a,c,l,h,d){let f=(o-r)/l-(a-r)/(l+h)+(a-o)/h,p=(a-o)/h-(c-o)/(h+d)+(c-a)/d;f*=h,p*=h,s(o,a,f,p)},calc:function(r){const o=r*r,a=o*r;return i+t*r+e*o+n*a}}}const Mc=new O,Iu=new Nd,Cu=new Nd,Pu=new Nd;class qM extends Ai{constructor(t=[],e=!1,n="centripetal",s=.5){super(),this.isCatmullRomCurve3=!0,this.type="CatmullRomCurve3",this.points=t,this.closed=e,this.curveType=n,this.tension=s}getPoint(t,e=new O){const n=e,s=this.points,r=s.length,o=(r-(this.closed?0:1))*t;let a=Math.floor(o),c=o-a;this.closed?a+=a>0?0:(Math.floor(Math.abs(a)/r)+1)*r:c===0&&a===r-1&&(a=r-2,c=1);let l,h;this.closed||a>0?l=s[(a-1)%r]:(Mc.subVectors(s[0],s[1]).add(s[0]),l=Mc);const d=s[a%r],f=s[(a+1)%r];if(this.closed||a+2<r?h=s[(a+2)%r]:(Mc.subVectors(s[r-1],s[r-2]).add(s[r-1]),h=Mc),this.curveType==="centripetal"||this.curveType==="chordal"){const p=this.curveType==="chordal"?.5:.25;let v=Math.pow(l.distanceToSquared(d),p),x=Math.pow(d.distanceToSquared(f),p),m=Math.pow(f.distanceToSquared(h),p);x<1e-4&&(x=1),v<1e-4&&(v=x),m<1e-4&&(m=x),Iu.initNonuniformCatmullRom(l.x,d.x,f.x,h.x,v,x,m),Cu.initNonuniformCatmullRom(l.y,d.y,f.y,h.y,v,x,m),Pu.initNonuniformCatmullRom(l.z,d.z,f.z,h.z,v,x,m)}else this.curveType==="catmullrom"&&(Iu.initCatmullRom(l.x,d.x,f.x,h.x,this.tension),Cu.initCatmullRom(l.y,d.y,f.y,h.y,this.tension),Pu.initCatmullRom(l.z,d.z,f.z,h.z,this.tension));return n.set(Iu.calc(c),Cu.calc(c),Pu.calc(c)),n}copy(t){super.copy(t),this.points=[];for(let e=0,n=t.points.length;e<n;e++){const s=t.points[e];this.points.push(s.clone())}return this.closed=t.closed,this.curveType=t.curveType,this.tension=t.tension,this}toJSON(){const t=super.toJSON();t.points=[];for(let e=0,n=this.points.length;e<n;e++){const s=this.points[e];t.points.push(s.toArray())}return t.closed=this.closed,t.curveType=this.curveType,t.tension=this.tension,t}fromJSON(t){super.fromJSON(t),this.points=[];for(let e=0,n=t.points.length;e<n;e++){const s=t.points[e];this.points.push(new O().fromArray(s))}return this.closed=t.closed,this.curveType=t.curveType,this.tension=t.tension,this}}function lm(i,t,e,n,s){const r=(n-t)*.5,o=(s-e)*.5,a=i*i,c=i*a;return(2*e-2*n+r+o)*c+(-3*e+3*n-2*r-o)*a+r*i+e}function jM(i,t){const e=1-i;return e*e*t}function KM(i,t){return 2*(1-i)*i*t}function $M(i,t){return i*i*t}function ta(i,t,e,n){return jM(i,t)+KM(i,e)+$M(i,n)}function YM(i,t){const e=1-i;return e*e*e*t}function JM(i,t){const e=1-i;return 3*e*e*i*t}function ZM(i,t){return 3*(1-i)*i*i*t}function QM(i,t){return i*i*i*t}function ea(i,t,e,n,s){return YM(i,t)+JM(i,e)+ZM(i,n)+QM(i,s)}class P_ extends Ai{constructor(t=new dt,e=new dt,n=new dt,s=new dt){super(),this.isCubicBezierCurve=!0,this.type="CubicBezierCurve",this.v0=t,this.v1=e,this.v2=n,this.v3=s}getPoint(t,e=new dt){const n=e,s=this.v0,r=this.v1,o=this.v2,a=this.v3;return n.set(ea(t,s.x,r.x,o.x,a.x),ea(t,s.y,r.y,o.y,a.y)),n}copy(t){return super.copy(t),this.v0.copy(t.v0),this.v1.copy(t.v1),this.v2.copy(t.v2),this.v3.copy(t.v3),this}toJSON(){const t=super.toJSON();return t.v0=this.v0.toArray(),t.v1=this.v1.toArray(),t.v2=this.v2.toArray(),t.v3=this.v3.toArray(),t}fromJSON(t){return super.fromJSON(t),this.v0.fromArray(t.v0),this.v1.fromArray(t.v1),this.v2.fromArray(t.v2),this.v3.fromArray(t.v3),this}}class tw extends Ai{constructor(t=new O,e=new O,n=new O,s=new O){super(),this.isCubicBezierCurve3=!0,this.type="CubicBezierCurve3",this.v0=t,this.v1=e,this.v2=n,this.v3=s}getPoint(t,e=new O){const n=e,s=this.v0,r=this.v1,o=this.v2,a=this.v3;return n.set(ea(t,s.x,r.x,o.x,a.x),ea(t,s.y,r.y,o.y,a.y),ea(t,s.z,r.z,o.z,a.z)),n}copy(t){return super.copy(t),this.v0.copy(t.v0),this.v1.copy(t.v1),this.v2.copy(t.v2),this.v3.copy(t.v3),this}toJSON(){const t=super.toJSON();return t.v0=this.v0.toArray(),t.v1=this.v1.toArray(),t.v2=this.v2.toArray(),t.v3=this.v3.toArray(),t}fromJSON(t){return super.fromJSON(t),this.v0.fromArray(t.v0),this.v1.fromArray(t.v1),this.v2.fromArray(t.v2),this.v3.fromArray(t.v3),this}}class D_ extends Ai{constructor(t=new dt,e=new dt){super(),this.isLineCurve=!0,this.type="LineCurve",this.v1=t,this.v2=e}getPoint(t,e=new dt){const n=e;return t===1?n.copy(this.v2):(n.copy(this.v2).sub(this.v1),n.multiplyScalar(t).add(this.v1)),n}getPointAt(t,e){return this.getPoint(t,e)}getTangent(t,e=new dt){return e.subVectors(this.v2,this.v1).normalize()}getTangentAt(t,e){return this.getTangent(t,e)}copy(t){return super.copy(t),this.v1.copy(t.v1),this.v2.copy(t.v2),this}toJSON(){const t=super.toJSON();return t.v1=this.v1.toArray(),t.v2=this.v2.toArray(),t}fromJSON(t){return super.fromJSON(t),this.v1.fromArray(t.v1),this.v2.fromArray(t.v2),this}}class ew extends Ai{constructor(t=new O,e=new O){super(),this.isLineCurve3=!0,this.type="LineCurve3",this.v1=t,this.v2=e}getPoint(t,e=new O){const n=e;return t===1?n.copy(this.v2):(n.copy(this.v2).sub(this.v1),n.multiplyScalar(t).add(this.v1)),n}getPointAt(t,e){return this.getPoint(t,e)}getTangent(t,e=new O){return e.subVectors(this.v2,this.v1).normalize()}getTangentAt(t,e){return this.getTangent(t,e)}copy(t){return super.copy(t),this.v1.copy(t.v1),this.v2.copy(t.v2),this}toJSON(){const t=super.toJSON();return t.v1=this.v1.toArray(),t.v2=this.v2.toArray(),t}fromJSON(t){return super.fromJSON(t),this.v1.fromArray(t.v1),this.v2.fromArray(t.v2),this}}class L_ extends Ai{constructor(t=new dt,e=new dt,n=new dt){super(),this.isQuadraticBezierCurve=!0,this.type="QuadraticBezierCurve",this.v0=t,this.v1=e,this.v2=n}getPoint(t,e=new dt){const n=e,s=this.v0,r=this.v1,o=this.v2;return n.set(ta(t,s.x,r.x,o.x),ta(t,s.y,r.y,o.y)),n}copy(t){return super.copy(t),this.v0.copy(t.v0),this.v1.copy(t.v1),this.v2.copy(t.v2),this}toJSON(){const t=super.toJSON();return t.v0=this.v0.toArray(),t.v1=this.v1.toArray(),t.v2=this.v2.toArray(),t}fromJSON(t){return super.fromJSON(t),this.v0.fromArray(t.v0),this.v1.fromArray(t.v1),this.v2.fromArray(t.v2),this}}class nw extends Ai{constructor(t=new O,e=new O,n=new O){super(),this.isQuadraticBezierCurve3=!0,this.type="QuadraticBezierCurve3",this.v0=t,this.v1=e,this.v2=n}getPoint(t,e=new O){const n=e,s=this.v0,r=this.v1,o=this.v2;return n.set(ta(t,s.x,r.x,o.x),ta(t,s.y,r.y,o.y),ta(t,s.z,r.z,o.z)),n}copy(t){return super.copy(t),this.v0.copy(t.v0),this.v1.copy(t.v1),this.v2.copy(t.v2),this}toJSON(){const t=super.toJSON();return t.v0=this.v0.toArray(),t.v1=this.v1.toArray(),t.v2=this.v2.toArray(),t}fromJSON(t){return super.fromJSON(t),this.v0.fromArray(t.v0),this.v1.fromArray(t.v1),this.v2.fromArray(t.v2),this}}class N_ extends Ai{constructor(t=[]){super(),this.isSplineCurve=!0,this.type="SplineCurve",this.points=t}getPoint(t,e=new dt){const n=e,s=this.points,r=(s.length-1)*t,o=Math.floor(r),a=r-o,c=s[o===0?o:o-1],l=s[o],h=s[o>s.length-2?s.length-1:o+1],d=s[o>s.length-3?s.length-1:o+2];return n.set(lm(a,c.x,l.x,h.x,d.x),lm(a,c.y,l.y,h.y,d.y)),n}copy(t){super.copy(t),this.points=[];for(let e=0,n=t.points.length;e<n;e++){const s=t.points[e];this.points.push(s.clone())}return this}toJSON(){const t=super.toJSON();t.points=[];for(let e=0,n=this.points.length;e<n;e++){const s=this.points[e];t.points.push(s.toArray())}return t}fromJSON(t){super.fromJSON(t),this.points=[];for(let e=0,n=t.points.length;e<n;e++){const s=t.points[e];this.points.push(new dt().fromArray(s))}return this}}var um=Object.freeze({__proto__:null,ArcCurve:XM,CatmullRomCurve3:qM,CubicBezierCurve:P_,CubicBezierCurve3:tw,EllipseCurve:Ld,LineCurve:D_,LineCurve3:ew,QuadraticBezierCurve:L_,QuadraticBezierCurve3:nw,SplineCurve:N_});class iw extends Ai{constructor(){super(),this.type="CurvePath",this.curves=[],this.autoClose=!1}add(t){this.curves.push(t)}closePath(){const t=this.curves[0].getPoint(0),e=this.curves[this.curves.length-1].getPoint(1);if(!t.equals(e)){const n=t.isVector2===!0?"LineCurve":"LineCurve3";this.curves.push(new um[n](e,t))}return this}getPoint(t,e){const n=t*this.getLength(),s=this.getCurveLengths();let r=0;for(;r<s.length;){if(s[r]>=n){const o=s[r]-n,a=this.curves[r],c=a.getLength(),l=c===0?0:1-o/c;return a.getPointAt(l,e)}r++}return null}getLength(){const t=this.getCurveLengths();return t[t.length-1]}updateArcLengths(){this.needsUpdate=!0,this.cacheLengths=null,this.getCurveLengths()}getCurveLengths(){if(this.cacheLengths&&this.cacheLengths.length===this.curves.length)return this.cacheLengths;const t=[];let e=0;for(let n=0,s=this.curves.length;n<s;n++)e+=this.curves[n].getLength(),t.push(e);return this.cacheLengths=t,t}getSpacedPoints(t=40){const e=[];for(let n=0;n<=t;n++)e.push(this.getPoint(n/t));return this.autoClose&&e.push(e[0]),e}getPoints(t=12){const e=[];let n;for(let s=0,r=this.curves;s<r.length;s++){const o=r[s],a=o.isEllipseCurve?t*2:o.isLineCurve||o.isLineCurve3?1:o.isSplineCurve?t*o.points.length:t,c=o.getPoints(a);for(let l=0;l<c.length;l++){const h=c[l];n&&n.equals(h)||(e.push(h),n=h)}}return this.autoClose&&e.length>1&&!e[e.length-1].equals(e[0])&&e.push(e[0]),e}copy(t){super.copy(t),this.curves=[];for(let e=0,n=t.curves.length;e<n;e++){const s=t.curves[e];this.curves.push(s.clone())}return this.autoClose=t.autoClose,this}toJSON(){const t=super.toJSON();t.autoClose=this.autoClose,t.curves=[];for(let e=0,n=this.curves.length;e<n;e++){const s=this.curves[e];t.curves.push(s.toJSON())}return t}fromJSON(t){super.fromJSON(t),this.autoClose=t.autoClose,this.curves=[];for(let e=0,n=t.curves.length;e<n;e++){const s=t.curves[e];this.curves.push(new um[s.type]().fromJSON(s))}return this}}class hm extends iw{constructor(t){super(),this.type="Path",this.currentPoint=new dt,t&&this.setFromPoints(t)}setFromPoints(t){this.moveTo(t[0].x,t[0].y);for(let e=1,n=t.length;e<n;e++)this.lineTo(t[e].x,t[e].y);return this}moveTo(t,e){return this.currentPoint.set(t,e),this}lineTo(t,e){const n=new D_(this.currentPoint.clone(),new dt(t,e));return this.curves.push(n),this.currentPoint.set(t,e),this}quadraticCurveTo(t,e,n,s){const r=new L_(this.currentPoint.clone(),new dt(t,e),new dt(n,s));return this.curves.push(r),this.currentPoint.set(n,s),this}bezierCurveTo(t,e,n,s,r,o){const a=new P_(this.currentPoint.clone(),new dt(t,e),new dt(n,s),new dt(r,o));return this.curves.push(a),this.currentPoint.set(r,o),this}splineThru(t){const e=[this.currentPoint.clone()].concat(t),n=new N_(e);return this.curves.push(n),this.currentPoint.copy(t[t.length-1]),this}arc(t,e,n,s,r,o){const a=this.currentPoint.x,c=this.currentPoint.y;return this.absarc(t+a,e+c,n,s,r,o),this}absarc(t,e,n,s,r,o){return this.absellipse(t,e,n,n,s,r,o),this}ellipse(t,e,n,s,r,o,a,c){const l=this.currentPoint.x,h=this.currentPoint.y;return this.absellipse(t+l,e+h,n,s,r,o,a,c),this}absellipse(t,e,n,s,r,o,a,c){const l=new Ld(t,e,n,s,r,o,a,c);if(this.curves.length>0){const d=l.getPoint(0);d.equals(this.currentPoint)||this.lineTo(d.x,d.y)}this.curves.push(l);const h=l.getPoint(1);return this.currentPoint.copy(h),this}copy(t){return super.copy(t),this.currentPoint.copy(t.currentPoint),this}toJSON(){const t=super.toJSON();return t.currentPoint=this.currentPoint.toArray(),t}fromJSON(t){return super.fromJSON(t),this.currentPoint.fromArray(t.currentPoint),this}}class bl extends mn{constructor(t=1,e=32,n=0,s=Math.PI*2){super(),this.type="CircleGeometry",this.parameters={radius:t,segments:e,thetaStart:n,thetaLength:s},e=Math.max(3,e);const r=[],o=[],a=[],c=[],l=new O,h=new dt;o.push(0,0,0),a.push(0,0,1),c.push(.5,.5);for(let d=0,f=3;d<=e;d++,f+=3){const p=n+d/e*s;l.x=t*Math.cos(p),l.y=t*Math.sin(p),o.push(l.x,l.y,l.z),a.push(0,0,1),h.x=(o[f]/t+1)/2,h.y=(o[f+1]/t+1)/2,c.push(h.x,h.y)}for(let d=1;d<=e;d++)r.push(d,d+1,0);this.setIndex(r),this.setAttribute("position",new we(o,3)),this.setAttribute("normal",new we(a,3)),this.setAttribute("uv",new we(c,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new bl(t.radius,t.segments,t.thetaStart,t.thetaLength)}}class ti extends mn{constructor(t=1,e=1,n=1,s=32,r=1,o=!1,a=0,c=Math.PI*2){super(),this.type="CylinderGeometry",this.parameters={radiusTop:t,radiusBottom:e,height:n,radialSegments:s,heightSegments:r,openEnded:o,thetaStart:a,thetaLength:c};const l=this;s=Math.floor(s),r=Math.floor(r);const h=[],d=[],f=[],p=[];let v=0;const x=[],m=n/2;let _=0;A(),o===!1&&(t>0&&S(!0),e>0&&S(!1)),this.setIndex(h),this.setAttribute("position",new we(d,3)),this.setAttribute("normal",new we(f,3)),this.setAttribute("uv",new we(p,2));function A(){const b=new O,F=new O;let N=0;const M=(e-t)/n;for(let w=0;w<=r;w++){const C=[],y=w/r,E=y*(e-t)+t;for(let L=0;L<=s;L++){const R=L/s,q=R*c+a,nt=Math.sin(q),j=Math.cos(q);F.x=E*nt,F.y=-y*n+m,F.z=E*j,d.push(F.x,F.y,F.z),b.set(nt,M,j).normalize(),f.push(b.x,b.y,b.z),p.push(R,1-y),C.push(v++)}x.push(C)}for(let w=0;w<s;w++)for(let C=0;C<r;C++){const y=x[C][w],E=x[C+1][w],L=x[C+1][w+1],R=x[C][w+1];t>0&&(h.push(y,E,R),N+=3),e>0&&(h.push(E,L,R),N+=3)}l.addGroup(_,N,0),_+=N}function S(b){const F=v,N=new dt,M=new O;let w=0;const C=b===!0?t:e,y=b===!0?1:-1;for(let L=1;L<=s;L++)d.push(0,m*y,0),f.push(0,y,0),p.push(.5,.5),v++;const E=v;for(let L=0;L<=s;L++){const q=L/s*c+a,nt=Math.cos(q),j=Math.sin(q);M.x=C*j,M.y=m*y,M.z=C*nt,d.push(M.x,M.y,M.z),f.push(0,y,0),N.x=nt*.5+.5,N.y=j*.5*y+.5,p.push(N.x,N.y),v++}for(let L=0;L<s;L++){const R=F+L,q=E+L;b===!0?h.push(q,q+1,R):h.push(q+1,q,R),w+=3}l.addGroup(_,w,b===!0?1:2),_+=w}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new ti(t.radiusTop,t.radiusBottom,t.height,t.radialSegments,t.heightSegments,t.openEnded,t.thetaStart,t.thetaLength)}}class sl extends ti{constructor(t=1,e=1,n=32,s=1,r=!1,o=0,a=Math.PI*2){super(0,t,e,n,s,r,o,a),this.type="ConeGeometry",this.parameters={radius:t,height:e,radialSegments:n,heightSegments:s,openEnded:r,thetaStart:o,thetaLength:a}}static fromJSON(t){return new sl(t.radius,t.height,t.radialSegments,t.heightSegments,t.openEnded,t.thetaStart,t.thetaLength)}}class Rl extends mn{constructor(t=[],e=[],n=1,s=0){super(),this.type="PolyhedronGeometry",this.parameters={vertices:t,indices:e,radius:n,detail:s};const r=[],o=[];a(s),l(n),h(),this.setAttribute("position",new we(r,3)),this.setAttribute("normal",new we(r.slice(),3)),this.setAttribute("uv",new we(o,2)),s===0?this.computeVertexNormals():this.normalizeNormals();function a(A){const S=new O,b=new O,F=new O;for(let N=0;N<e.length;N+=3)p(e[N+0],S),p(e[N+1],b),p(e[N+2],F),c(S,b,F,A)}function c(A,S,b,F){const N=F+1,M=[];for(let w=0;w<=N;w++){M[w]=[];const C=A.clone().lerp(b,w/N),y=S.clone().lerp(b,w/N),E=N-w;for(let L=0;L<=E;L++)L===0&&w===N?M[w][L]=C:M[w][L]=C.clone().lerp(y,L/E)}for(let w=0;w<N;w++)for(let C=0;C<2*(N-w)-1;C++){const y=Math.floor(C/2);C%2===0?(f(M[w][y+1]),f(M[w+1][y]),f(M[w][y])):(f(M[w][y+1]),f(M[w+1][y+1]),f(M[w+1][y]))}}function l(A){const S=new O;for(let b=0;b<r.length;b+=3)S.x=r[b+0],S.y=r[b+1],S.z=r[b+2],S.normalize().multiplyScalar(A),r[b+0]=S.x,r[b+1]=S.y,r[b+2]=S.z}function h(){const A=new O;for(let S=0;S<r.length;S+=3){A.x=r[S+0],A.y=r[S+1],A.z=r[S+2];const b=m(A)/2/Math.PI+.5,F=_(A)/Math.PI+.5;o.push(b,1-F)}v(),d()}function d(){for(let A=0;A<o.length;A+=6){const S=o[A+0],b=o[A+2],F=o[A+4],N=Math.max(S,b,F),M=Math.min(S,b,F);N>.9&&M<.1&&(S<.2&&(o[A+0]+=1),b<.2&&(o[A+2]+=1),F<.2&&(o[A+4]+=1))}}function f(A){r.push(A.x,A.y,A.z)}function p(A,S){const b=A*3;S.x=t[b+0],S.y=t[b+1],S.z=t[b+2]}function v(){const A=new O,S=new O,b=new O,F=new O,N=new dt,M=new dt,w=new dt;for(let C=0,y=0;C<r.length;C+=9,y+=6){A.set(r[C+0],r[C+1],r[C+2]),S.set(r[C+3],r[C+4],r[C+5]),b.set(r[C+6],r[C+7],r[C+8]),N.set(o[y+0],o[y+1]),M.set(o[y+2],o[y+3]),w.set(o[y+4],o[y+5]),F.copy(A).add(S).add(b).divideScalar(3);const E=m(F);x(N,y+0,A,E),x(M,y+2,S,E),x(w,y+4,b,E)}}function x(A,S,b,F){F<0&&A.x===1&&(o[S]=A.x-1),b.x===0&&b.z===0&&(o[S]=F/2/Math.PI+.5)}function m(A){return Math.atan2(A.z,-A.x)}function _(A){return Math.atan2(-A.y,Math.sqrt(A.x*A.x+A.z*A.z))}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new Rl(t.vertices,t.indices,t.radius,t.details)}}class pa extends Rl{constructor(t=1,e=0){const n=(1+Math.sqrt(5))/2,s=1/n,r=[-1,-1,-1,-1,-1,1,-1,1,-1,-1,1,1,1,-1,-1,1,-1,1,1,1,-1,1,1,1,0,-s,-n,0,-s,n,0,s,-n,0,s,n,-s,-n,0,-s,n,0,s,-n,0,s,n,0,-n,0,-s,n,0,-s,-n,0,s,n,0,s],o=[3,11,7,3,7,15,3,15,13,7,19,17,7,17,6,7,6,15,17,4,8,17,8,10,17,10,6,8,0,16,8,16,2,8,2,10,0,12,1,0,1,18,0,18,16,6,10,2,6,2,13,6,13,15,2,16,18,2,18,3,2,3,13,18,1,9,18,9,11,18,11,3,4,14,12,4,12,0,4,0,8,11,9,5,11,5,19,11,19,7,19,5,14,19,14,4,19,4,17,1,12,14,1,14,5,1,5,9];super(r,o,t,e),this.type="DodecahedronGeometry",this.parameters={radius:t,detail:e}}static fromJSON(t){return new pa(t.radius,t.detail)}}class U_ extends hm{constructor(t){super(t),this.uuid=qn(),this.type="Shape",this.holes=[]}getPointsHoles(t){const e=[];for(let n=0,s=this.holes.length;n<s;n++)e[n]=this.holes[n].getPoints(t);return e}extractPoints(t){return{shape:this.getPoints(t),holes:this.getPointsHoles(t)}}copy(t){super.copy(t),this.holes=[];for(let e=0,n=t.holes.length;e<n;e++){const s=t.holes[e];this.holes.push(s.clone())}return this}toJSON(){const t=super.toJSON();t.uuid=this.uuid,t.holes=[];for(let e=0,n=this.holes.length;e<n;e++){const s=this.holes[e];t.holes.push(s.toJSON())}return t}fromJSON(t){super.fromJSON(t),this.uuid=t.uuid,this.holes=[];for(let e=0,n=t.holes.length;e<n;e++){const s=t.holes[e];this.holes.push(new hm().fromJSON(s))}return this}}const sw={triangulate:function(i,t,e=2){const n=t&&t.length,s=n?t[0]*e:i.length;let r=O_(i,0,s,e,!0);const o=[];if(!r||r.next===r.prev)return o;let a,c,l,h,d,f,p;if(n&&(r=lw(i,t,r,e)),i.length>80*e){a=l=i[0],c=h=i[1];for(let v=e;v<s;v+=e)d=i[v],f=i[v+1],d<a&&(a=d),f<c&&(c=f),d>l&&(l=d),f>h&&(h=f);p=Math.max(l-a,h-c),p=p!==0?32767/p:0}return ma(r,o,e,a,c,p,0),o}};function O_(i,t,e,n,s){let r,o;if(s===xw(i,t,e,n)>0)for(r=t;r<e;r+=n)o=dm(r,i[r],i[r+1],o);else for(r=e-n;r>=t;r-=n)o=dm(r,i[r],i[r+1],o);return o&&Il(o,o.next)&&(_a(o),o=o.next),o}function Js(i,t){if(!i)return i;t||(t=i);let e=i,n;do if(n=!1,!e.steiner&&(Il(e,e.next)||Ue(e.prev,e,e.next)===0)){if(_a(e),e=t=e.prev,e===e.next)break;n=!0}else e=e.next;while(n||e!==t);return t}function ma(i,t,e,n,s,r,o){if(!i)return;!o&&r&&pw(i,n,s,r);let a=i,c,l;for(;i.prev!==i.next;){if(c=i.prev,l=i.next,r?ow(i,n,s,r):rw(i)){t.push(c.i/e|0),t.push(i.i/e|0),t.push(l.i/e|0),_a(i),i=l.next,a=l.next;continue}if(i=l,i===a){o?o===1?(i=aw(Js(i),t,e),ma(i,t,e,n,s,r,2)):o===2&&cw(i,t,e,n,s,r):ma(Js(i),t,e,n,s,r,1);break}}}function rw(i){const t=i.prev,e=i,n=i.next;if(Ue(t,e,n)>=0)return!1;const s=t.x,r=e.x,o=n.x,a=t.y,c=e.y,l=n.y,h=s<r?s<o?s:o:r<o?r:o,d=a<c?a<l?a:l:c<l?c:l,f=s>r?s>o?s:o:r>o?r:o,p=a>c?a>l?a:l:c>l?c:l;let v=n.next;for(;v!==t;){if(v.x>=h&&v.x<=f&&v.y>=d&&v.y<=p&&Vr(s,a,r,c,o,l,v.x,v.y)&&Ue(v.prev,v,v.next)>=0)return!1;v=v.next}return!0}function ow(i,t,e,n){const s=i.prev,r=i,o=i.next;if(Ue(s,r,o)>=0)return!1;const a=s.x,c=r.x,l=o.x,h=s.y,d=r.y,f=o.y,p=a<c?a<l?a:l:c<l?c:l,v=h<d?h<f?h:f:d<f?d:f,x=a>c?a>l?a:l:c>l?c:l,m=h>d?h>f?h:f:d>f?d:f,_=Bh(p,v,t,e,n),A=Bh(x,m,t,e,n);let S=i.prevZ,b=i.nextZ;for(;S&&S.z>=_&&b&&b.z<=A;){if(S.x>=p&&S.x<=x&&S.y>=v&&S.y<=m&&S!==s&&S!==o&&Vr(a,h,c,d,l,f,S.x,S.y)&&Ue(S.prev,S,S.next)>=0||(S=S.prevZ,b.x>=p&&b.x<=x&&b.y>=v&&b.y<=m&&b!==s&&b!==o&&Vr(a,h,c,d,l,f,b.x,b.y)&&Ue(b.prev,b,b.next)>=0))return!1;b=b.nextZ}for(;S&&S.z>=_;){if(S.x>=p&&S.x<=x&&S.y>=v&&S.y<=m&&S!==s&&S!==o&&Vr(a,h,c,d,l,f,S.x,S.y)&&Ue(S.prev,S,S.next)>=0)return!1;S=S.prevZ}for(;b&&b.z<=A;){if(b.x>=p&&b.x<=x&&b.y>=v&&b.y<=m&&b!==s&&b!==o&&Vr(a,h,c,d,l,f,b.x,b.y)&&Ue(b.prev,b,b.next)>=0)return!1;b=b.nextZ}return!0}function aw(i,t,e){let n=i;do{const s=n.prev,r=n.next.next;!Il(s,r)&&F_(s,n,n.next,r)&&ga(s,r)&&ga(r,s)&&(t.push(s.i/e|0),t.push(n.i/e|0),t.push(r.i/e|0),_a(n),_a(n.next),n=i=r),n=n.next}while(n!==i);return Js(n)}function cw(i,t,e,n,s,r){let o=i;do{let a=o.next.next;for(;a!==o.prev;){if(o.i!==a.i&&_w(o,a)){let c=V_(o,a);o=Js(o,o.next),c=Js(c,c.next),ma(o,t,e,n,s,r,0),ma(c,t,e,n,s,r,0);return}a=a.next}o=o.next}while(o!==i)}function lw(i,t,e,n){const s=[];let r,o,a,c,l;for(r=0,o=t.length;r<o;r++)a=t[r]*n,c=r<o-1?t[r+1]*n:i.length,l=O_(i,a,c,n,!1),l===l.next&&(l.steiner=!0),s.push(gw(l));for(s.sort(uw),r=0;r<s.length;r++)e=hw(s[r],e);return e}function uw(i,t){return i.x-t.x}function hw(i,t){const e=dw(i,t);if(!e)return t;const n=V_(e,i);return Js(n,n.next),Js(e,e.next)}function dw(i,t){let e=t,n=-1/0,s;const r=i.x,o=i.y;do{if(o<=e.y&&o>=e.next.y&&e.next.y!==e.y){const f=e.x+(o-e.y)*(e.next.x-e.x)/(e.next.y-e.y);if(f<=r&&f>n&&(n=f,s=e.x<e.next.x?e:e.next,f===r))return s}e=e.next}while(e!==t);if(!s)return null;const a=s,c=s.x,l=s.y;let h=1/0,d;e=s;do r>=e.x&&e.x>=c&&r!==e.x&&Vr(o<l?r:n,o,c,l,o<l?n:r,o,e.x,e.y)&&(d=Math.abs(o-e.y)/(r-e.x),ga(e,i)&&(d<h||d===h&&(e.x>s.x||e.x===s.x&&fw(s,e)))&&(s=e,h=d)),e=e.next;while(e!==a);return s}function fw(i,t){return Ue(i.prev,i,t.prev)<0&&Ue(t.next,i,i.next)<0}function pw(i,t,e,n){let s=i;do s.z===0&&(s.z=Bh(s.x,s.y,t,e,n)),s.prevZ=s.prev,s.nextZ=s.next,s=s.next;while(s!==i);s.prevZ.nextZ=null,s.prevZ=null,mw(s)}function mw(i){let t,e,n,s,r,o,a,c,l=1;do{for(e=i,i=null,r=null,o=0;e;){for(o++,n=e,a=0,t=0;t<l&&(a++,n=n.nextZ,!!n);t++);for(c=l;a>0||c>0&&n;)a!==0&&(c===0||!n||e.z<=n.z)?(s=e,e=e.nextZ,a--):(s=n,n=n.nextZ,c--),r?r.nextZ=s:i=s,s.prevZ=r,r=s;e=n}r.nextZ=null,l*=2}while(o>1);return i}function Bh(i,t,e,n,s){return i=(i-e)*s|0,t=(t-n)*s|0,i=(i|i<<8)&16711935,i=(i|i<<4)&252645135,i=(i|i<<2)&858993459,i=(i|i<<1)&1431655765,t=(t|t<<8)&16711935,t=(t|t<<4)&252645135,t=(t|t<<2)&858993459,t=(t|t<<1)&1431655765,i|t<<1}function gw(i){let t=i,e=i;do(t.x<e.x||t.x===e.x&&t.y<e.y)&&(e=t),t=t.next;while(t!==i);return e}function Vr(i,t,e,n,s,r,o,a){return(s-o)*(t-a)>=(i-o)*(r-a)&&(i-o)*(n-a)>=(e-o)*(t-a)&&(e-o)*(r-a)>=(s-o)*(n-a)}function _w(i,t){return i.next.i!==t.i&&i.prev.i!==t.i&&!vw(i,t)&&(ga(i,t)&&ga(t,i)&&yw(i,t)&&(Ue(i.prev,i,t.prev)||Ue(i,t.prev,t))||Il(i,t)&&Ue(i.prev,i,i.next)>0&&Ue(t.prev,t,t.next)>0)}function Ue(i,t,e){return(t.y-i.y)*(e.x-t.x)-(t.x-i.x)*(e.y-t.y)}function Il(i,t){return i.x===t.x&&i.y===t.y}function F_(i,t,e,n){const s=bc(Ue(i,t,e)),r=bc(Ue(i,t,n)),o=bc(Ue(e,n,i)),a=bc(Ue(e,n,t));return!!(s!==r&&o!==a||s===0&&wc(i,e,t)||r===0&&wc(i,n,t)||o===0&&wc(e,i,n)||a===0&&wc(e,t,n))}function wc(i,t,e){return t.x<=Math.max(i.x,e.x)&&t.x>=Math.min(i.x,e.x)&&t.y<=Math.max(i.y,e.y)&&t.y>=Math.min(i.y,e.y)}function bc(i){return i>0?1:i<0?-1:0}function vw(i,t){let e=i;do{if(e.i!==i.i&&e.next.i!==i.i&&e.i!==t.i&&e.next.i!==t.i&&F_(e,e.next,i,t))return!0;e=e.next}while(e!==i);return!1}function ga(i,t){return Ue(i.prev,i,i.next)<0?Ue(i,t,i.next)>=0&&Ue(i,i.prev,t)>=0:Ue(i,t,i.prev)<0||Ue(i,i.next,t)<0}function yw(i,t){let e=i,n=!1;const s=(i.x+t.x)/2,r=(i.y+t.y)/2;do e.y>r!=e.next.y>r&&e.next.y!==e.y&&s<(e.next.x-e.x)*(r-e.y)/(e.next.y-e.y)+e.x&&(n=!n),e=e.next;while(e!==i);return n}function V_(i,t){const e=new kh(i.i,i.x,i.y),n=new kh(t.i,t.x,t.y),s=i.next,r=t.prev;return i.next=t,t.prev=i,e.next=s,s.prev=e,n.next=e,e.prev=n,r.next=n,n.prev=r,n}function dm(i,t,e,n){const s=new kh(i,t,e);return n?(s.next=n.next,s.prev=n,n.next.prev=s,n.next=s):(s.prev=s,s.next=s),s}function _a(i){i.next.prev=i.prev,i.prev.next=i.next,i.prevZ&&(i.prevZ.nextZ=i.nextZ),i.nextZ&&(i.nextZ.prevZ=i.prevZ)}function kh(i,t,e){this.i=i,this.x=t,this.y=e,this.prev=null,this.next=null,this.z=0,this.prevZ=null,this.nextZ=null,this.steiner=!1}function xw(i,t,e,n){let s=0;for(let r=t,o=e-n;r<e;r+=n)s+=(i[o]-i[r])*(i[r+1]+i[o+1]),o=r;return s}class na{static area(t){const e=t.length;let n=0;for(let s=e-1,r=0;r<e;s=r++)n+=t[s].x*t[r].y-t[r].x*t[s].y;return n*.5}static isClockWise(t){return na.area(t)<0}static triangulateShape(t,e){const n=[],s=[],r=[];fm(t),pm(n,t);let o=t.length;e.forEach(fm);for(let c=0;c<e.length;c++)s.push(o),o+=e[c].length,pm(n,e[c]);const a=sw.triangulate(n,s);for(let c=0;c<a.length;c+=3)r.push(a.slice(c,c+3));return r}}function fm(i){const t=i.length;t>2&&i[t-1].equals(i[0])&&i.pop()}function pm(i,t){for(let e=0;e<t.length;e++)i.push(t[e].x),i.push(t[e].y)}class B_ extends Rl{constructor(t=1,e=0){const n=[1,0,0,-1,0,0,0,1,0,0,-1,0,0,0,1,0,0,-1],s=[0,2,4,0,4,3,0,3,5,0,5,2,1,2,5,1,5,3,1,3,4,1,4,2];super(n,s,t,e),this.type="OctahedronGeometry",this.parameters={radius:t,detail:e}}static fromJSON(t){return new B_(t.radius,t.detail)}}class Ud extends mn{constructor(t=new U_([new dt(0,.5),new dt(-.5,-.5),new dt(.5,-.5)]),e=12){super(),this.type="ShapeGeometry",this.parameters={shapes:t,curveSegments:e};const n=[],s=[],r=[],o=[];let a=0,c=0;if(Array.isArray(t)===!1)l(t);else for(let h=0;h<t.length;h++)l(t[h]),this.addGroup(a,c,h),a+=c,c=0;this.setIndex(n),this.setAttribute("position",new we(s,3)),this.setAttribute("normal",new we(r,3)),this.setAttribute("uv",new we(o,2));function l(h){const d=s.length/3,f=h.extractPoints(e);let p=f.shape;const v=f.holes;na.isClockWise(p)===!1&&(p=p.reverse());for(let m=0,_=v.length;m<_;m++){const A=v[m];na.isClockWise(A)===!0&&(v[m]=A.reverse())}const x=na.triangulateShape(p,v);for(let m=0,_=v.length;m<_;m++){const A=v[m];p=p.concat(A)}for(let m=0,_=p.length;m<_;m++){const A=p[m];s.push(A.x,A.y,0),r.push(0,0,1),o.push(A.x,A.y)}for(let m=0,_=x.length;m<_;m++){const A=x[m],S=A[0]+d,b=A[1]+d,F=A[2]+d;n.push(S,b,F),c+=3}}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}toJSON(){const t=super.toJSON(),e=this.parameters.shapes;return Ew(e,t)}static fromJSON(t,e){const n=[];for(let s=0,r=t.shapes.length;s<r;s++){const o=e[t.shapes[s]];n.push(o)}return new Ud(n,t.curveSegments)}}function Ew(i,t){if(t.shapes=[],Array.isArray(i))for(let e=0,n=i.length;e<n;e++){const s=i[e];t.shapes.push(s.uuid)}else t.shapes.push(i.uuid);return t}class ui extends mn{constructor(t=1,e=32,n=16,s=0,r=Math.PI*2,o=0,a=Math.PI){super(),this.type="SphereGeometry",this.parameters={radius:t,widthSegments:e,heightSegments:n,phiStart:s,phiLength:r,thetaStart:o,thetaLength:a},e=Math.max(3,Math.floor(e)),n=Math.max(2,Math.floor(n));const c=Math.min(o+a,Math.PI);let l=0;const h=[],d=new O,f=new O,p=[],v=[],x=[],m=[];for(let _=0;_<=n;_++){const A=[],S=_/n;let b=0;_===0&&o===0?b=.5/e:_===n&&c===Math.PI&&(b=-.5/e);for(let F=0;F<=e;F++){const N=F/e;d.x=-t*Math.cos(s+N*r)*Math.sin(o+S*a),d.y=t*Math.cos(o+S*a),d.z=t*Math.sin(s+N*r)*Math.sin(o+S*a),v.push(d.x,d.y,d.z),f.copy(d).normalize(),x.push(f.x,f.y,f.z),m.push(N+b,1-S),A.push(l++)}h.push(A)}for(let _=0;_<n;_++)for(let A=0;A<e;A++){const S=h[_][A+1],b=h[_][A],F=h[_+1][A],N=h[_+1][A+1];(_!==0||o>0)&&p.push(S,b,N),(_!==n-1||c<Math.PI)&&p.push(b,F,N)}this.setIndex(p),this.setAttribute("position",new we(v,3)),this.setAttribute("normal",new we(x,3)),this.setAttribute("uv",new we(m,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new ui(t.radius,t.widthSegments,t.heightSegments,t.phiStart,t.phiLength,t.thetaStart,t.thetaLength)}}class rl extends mn{constructor(t=1,e=.4,n=12,s=48,r=Math.PI*2){super(),this.type="TorusGeometry",this.parameters={radius:t,tube:e,radialSegments:n,tubularSegments:s,arc:r},n=Math.floor(n),s=Math.floor(s);const o=[],a=[],c=[],l=[],h=new O,d=new O,f=new O;for(let p=0;p<=n;p++)for(let v=0;v<=s;v++){const x=v/s*r,m=p/n*Math.PI*2;d.x=(t+e*Math.cos(m))*Math.cos(x),d.y=(t+e*Math.cos(m))*Math.sin(x),d.z=e*Math.sin(m),a.push(d.x,d.y,d.z),h.x=t*Math.cos(x),h.y=t*Math.sin(x),f.subVectors(d,h).normalize(),c.push(f.x,f.y,f.z),l.push(v/s),l.push(p/n)}for(let p=1;p<=n;p++)for(let v=1;v<=s;v++){const x=(s+1)*p+v-1,m=(s+1)*(p-1)+v-1,_=(s+1)*(p-1)+v,A=(s+1)*p+v;o.push(x,m,A),o.push(m,_,A)}this.setIndex(o),this.setAttribute("position",new we(a,3)),this.setAttribute("normal",new we(c,3)),this.setAttribute("uv",new we(l,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new rl(t.radius,t.tube,t.radialSegments,t.tubularSegments,t.arc)}}class Od extends jn{constructor(t){super(),this.isMeshStandardMaterial=!0,this.defines={STANDARD:""},this.type="MeshStandardMaterial",this.color=new It(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new It(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=Ad,this.normalScale=new dt(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new ai,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.defines={STANDARD:""},this.color.copy(t.color),this.roughness=t.roughness,this.metalness=t.metalness,this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.emissive.copy(t.emissive),this.emissiveMap=t.emissiveMap,this.emissiveIntensity=t.emissiveIntensity,this.bumpMap=t.bumpMap,this.bumpScale=t.bumpScale,this.normalMap=t.normalMap,this.normalMapType=t.normalMapType,this.normalScale.copy(t.normalScale),this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.roughnessMap=t.roughnessMap,this.metalnessMap=t.metalnessMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.envMapIntensity=t.envMapIntensity,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.flatShading=t.flatShading,this.fog=t.fog,this}}class Mi extends Od{constructor(t){super(),this.isMeshPhysicalMaterial=!0,this.defines={STANDARD:"",PHYSICAL:""},this.type="MeshPhysicalMaterial",this.anisotropyRotation=0,this.anisotropyMap=null,this.clearcoatMap=null,this.clearcoatRoughness=0,this.clearcoatRoughnessMap=null,this.clearcoatNormalScale=new dt(1,1),this.clearcoatNormalMap=null,this.ior=1.5,Object.defineProperty(this,"reflectivity",{get:function(){return $e(2.5*(this.ior-1)/(this.ior+1),0,1)},set:function(e){this.ior=(1+.4*e)/(1-.4*e)}}),this.iridescenceMap=null,this.iridescenceIOR=1.3,this.iridescenceThicknessRange=[100,400],this.iridescenceThicknessMap=null,this.sheenColor=new It(0),this.sheenColorMap=null,this.sheenRoughness=1,this.sheenRoughnessMap=null,this.transmissionMap=null,this.thickness=0,this.thicknessMap=null,this.attenuationDistance=1/0,this.attenuationColor=new It(1,1,1),this.specularIntensity=1,this.specularIntensityMap=null,this.specularColor=new It(1,1,1),this.specularColorMap=null,this._anisotropy=0,this._clearcoat=0,this._dispersion=0,this._iridescence=0,this._sheen=0,this._transmission=0,this.setValues(t)}get anisotropy(){return this._anisotropy}set anisotropy(t){this._anisotropy>0!=t>0&&this.version++,this._anisotropy=t}get clearcoat(){return this._clearcoat}set clearcoat(t){this._clearcoat>0!=t>0&&this.version++,this._clearcoat=t}get iridescence(){return this._iridescence}set iridescence(t){this._iridescence>0!=t>0&&this.version++,this._iridescence=t}get dispersion(){return this._dispersion}set dispersion(t){this._dispersion>0!=t>0&&this.version++,this._dispersion=t}get sheen(){return this._sheen}set sheen(t){this._sheen>0!=t>0&&this.version++,this._sheen=t}get transmission(){return this._transmission}set transmission(t){this._transmission>0!=t>0&&this.version++,this._transmission=t}copy(t){return super.copy(t),this.defines={STANDARD:"",PHYSICAL:""},this.anisotropy=t.anisotropy,this.anisotropyRotation=t.anisotropyRotation,this.anisotropyMap=t.anisotropyMap,this.clearcoat=t.clearcoat,this.clearcoatMap=t.clearcoatMap,this.clearcoatRoughness=t.clearcoatRoughness,this.clearcoatRoughnessMap=t.clearcoatRoughnessMap,this.clearcoatNormalMap=t.clearcoatNormalMap,this.clearcoatNormalScale.copy(t.clearcoatNormalScale),this.dispersion=t.dispersion,this.ior=t.ior,this.iridescence=t.iridescence,this.iridescenceMap=t.iridescenceMap,this.iridescenceIOR=t.iridescenceIOR,this.iridescenceThicknessRange=[...t.iridescenceThicknessRange],this.iridescenceThicknessMap=t.iridescenceThicknessMap,this.sheen=t.sheen,this.sheenColor.copy(t.sheenColor),this.sheenColorMap=t.sheenColorMap,this.sheenRoughness=t.sheenRoughness,this.sheenRoughnessMap=t.sheenRoughnessMap,this.transmission=t.transmission,this.transmissionMap=t.transmissionMap,this.thickness=t.thickness,this.thicknessMap=t.thicknessMap,this.attenuationDistance=t.attenuationDistance,this.attenuationColor.copy(t.attenuationColor),this.specularIntensity=t.specularIntensity,this.specularIntensityMap=t.specularIntensityMap,this.specularColor.copy(t.specularColor),this.specularColorMap=t.specularColorMap,this}}class gs extends jn{constructor(t){super(),this.isMeshLambertMaterial=!0,this.type="MeshLambertMaterial",this.color=new It(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new It(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=Ad,this.normalScale=new dt(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new ai,this.combine=md,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.emissive.copy(t.emissive),this.emissiveMap=t.emissiveMap,this.emissiveIntensity=t.emissiveIntensity,this.bumpMap=t.bumpMap,this.bumpScale=t.bumpScale,this.normalMap=t.normalMap,this.normalMapType=t.normalMapType,this.normalScale.copy(t.normalScale),this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.specularMap=t.specularMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.combine=t.combine,this.reflectivity=t.reflectivity,this.refractionRatio=t.refractionRatio,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.flatShading=t.flatShading,this.fog=t.fog,this}}function Rc(i,t,e){return!i||!e&&i.constructor===t?i:typeof t.BYTES_PER_ELEMENT=="number"?new t(i):Array.prototype.slice.call(i)}function Tw(i){return ArrayBuffer.isView(i)&&!(i instanceof DataView)}function Sw(i){function t(s,r){return i[s]-i[r]}const e=i.length,n=new Array(e);for(let s=0;s!==e;++s)n[s]=s;return n.sort(t),n}function mm(i,t,e){const n=i.length,s=new i.constructor(n);for(let r=0,o=0;o!==n;++r){const a=e[r]*t;for(let c=0;c!==t;++c)s[o++]=i[a+c]}return s}function k_(i,t,e,n){let s=1,r=i[0];for(;r!==void 0&&r[n]===void 0;)r=i[s++];if(r===void 0)return;let o=r[n];if(o!==void 0)if(Array.isArray(o))do o=r[n],o!==void 0&&(t.push(r.time),e.push.apply(e,o)),r=i[s++];while(r!==void 0);else if(o.toArray!==void 0)do o=r[n],o!==void 0&&(t.push(r.time),o.toArray(e,e.length)),r=i[s++];while(r!==void 0);else do o=r[n],o!==void 0&&(t.push(r.time),e.push(o)),r=i[s++];while(r!==void 0)}class Pa{constructor(t,e,n,s){this.parameterPositions=t,this._cachedIndex=0,this.resultBuffer=s!==void 0?s:new e.constructor(n),this.sampleValues=e,this.valueSize=n,this.settings=null,this.DefaultSettings_={}}evaluate(t){const e=this.parameterPositions;let n=this._cachedIndex,s=e[n],r=e[n-1];t:{e:{let o;n:{i:if(!(t<s)){for(let a=n+2;;){if(s===void 0){if(t<r)break i;return n=e.length,this._cachedIndex=n,this.copySampleValue_(n-1)}if(n===a)break;if(r=s,s=e[++n],t<s)break e}o=e.length;break n}if(!(t>=r)){const a=e[1];t<a&&(n=2,r=a);for(let c=n-2;;){if(r===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(n===c)break;if(s=r,r=e[--n-1],t>=r)break e}o=n,n=0;break n}break t}for(;n<o;){const a=n+o>>>1;t<e[a]?o=a:n=a+1}if(s=e[n],r=e[n-1],r===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(s===void 0)return n=e.length,this._cachedIndex=n,this.copySampleValue_(n-1)}this._cachedIndex=n,this.intervalChanged_(n,r,s)}return this.interpolate_(n,r,t,s)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(t){const e=this.resultBuffer,n=this.sampleValues,s=this.valueSize,r=t*s;for(let o=0;o!==s;++o)e[o]=n[r+o];return e}interpolate_(){throw new Error("call to abstract method")}intervalChanged_(){}}class Aw extends Pa{constructor(t,e,n,s){super(t,e,n,s),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:Ur,endingEnd:Ur}}intervalChanged_(t,e,n){const s=this.parameterPositions;let r=t-2,o=t+1,a=s[r],c=s[o];if(a===void 0)switch(this.getSettings_().endingStart){case Or:r=t,a=2*e-n;break;case Jc:r=s.length-2,a=e+s[r]-s[r+1];break;default:r=t,a=n}if(c===void 0)switch(this.getSettings_().endingEnd){case Or:o=t,c=2*n-e;break;case Jc:o=1,c=n+s[1]-s[0];break;default:o=t-1,c=e}const l=(n-e)*.5,h=this.valueSize;this._weightPrev=l/(e-a),this._weightNext=l/(c-n),this._offsetPrev=r*h,this._offsetNext=o*h}interpolate_(t,e,n,s){const r=this.resultBuffer,o=this.sampleValues,a=this.valueSize,c=t*a,l=c-a,h=this._offsetPrev,d=this._offsetNext,f=this._weightPrev,p=this._weightNext,v=(n-e)/(s-e),x=v*v,m=x*v,_=-f*m+2*f*x-f*v,A=(1+f)*m+(-1.5-2*f)*x+(-.5+f)*v+1,S=(-1-p)*m+(1.5+p)*x+.5*v,b=p*m-p*x;for(let F=0;F!==a;++F)r[F]=_*o[h+F]+A*o[l+F]+S*o[c+F]+b*o[d+F];return r}}class z_ extends Pa{constructor(t,e,n,s){super(t,e,n,s)}interpolate_(t,e,n,s){const r=this.resultBuffer,o=this.sampleValues,a=this.valueSize,c=t*a,l=c-a,h=(n-e)/(s-e),d=1-h;for(let f=0;f!==a;++f)r[f]=o[l+f]*d+o[c+f]*h;return r}}class Mw extends Pa{constructor(t,e,n,s){super(t,e,n,s)}interpolate_(t){return this.copySampleValue_(t-1)}}class wi{constructor(t,e,n,s){if(t===void 0)throw new Error("THREE.KeyframeTrack: track name is undefined");if(e===void 0||e.length===0)throw new Error("THREE.KeyframeTrack: no keyframes in track named "+t);this.name=t,this.times=Rc(e,this.TimeBufferType),this.values=Rc(n,this.ValueBufferType),this.setInterpolation(s||this.DefaultInterpolation)}static toJSON(t){const e=t.constructor;let n;if(e.toJSON!==this.toJSON)n=e.toJSON(t);else{n={name:t.name,times:Rc(t.times,Array),values:Rc(t.values,Array)};const s=t.getInterpolation();s!==t.DefaultInterpolation&&(n.interpolation=s)}return n.type=t.ValueTypeName,n}InterpolantFactoryMethodDiscrete(t){return new Mw(this.times,this.values,this.getValueSize(),t)}InterpolantFactoryMethodLinear(t){return new z_(this.times,this.values,this.getValueSize(),t)}InterpolantFactoryMethodSmooth(t){return new Aw(this.times,this.values,this.getValueSize(),t)}setInterpolation(t){let e;switch(t){case ua:e=this.InterpolantFactoryMethodDiscrete;break;case ha:e=this.InterpolantFactoryMethodLinear;break;case Yl:e=this.InterpolantFactoryMethodSmooth;break}if(e===void 0){const n="unsupported interpolation for "+this.ValueTypeName+" keyframe track named "+this.name;if(this.createInterpolant===void 0)if(t!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw new Error(n);return console.warn("THREE.KeyframeTrack:",n),this}return this.createInterpolant=e,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return ua;case this.InterpolantFactoryMethodLinear:return ha;case this.InterpolantFactoryMethodSmooth:return Yl}}getValueSize(){return this.values.length/this.times.length}shift(t){if(t!==0){const e=this.times;for(let n=0,s=e.length;n!==s;++n)e[n]+=t}return this}scale(t){if(t!==1){const e=this.times;for(let n=0,s=e.length;n!==s;++n)e[n]*=t}return this}trim(t,e){const n=this.times,s=n.length;let r=0,o=s-1;for(;r!==s&&n[r]<t;)++r;for(;o!==-1&&n[o]>e;)--o;if(++o,r!==0||o!==s){r>=o&&(o=Math.max(o,1),r=o-1);const a=this.getValueSize();this.times=n.slice(r,o),this.values=this.values.slice(r*a,o*a)}return this}validate(){let t=!0;const e=this.getValueSize();e-Math.floor(e)!==0&&(console.error("THREE.KeyframeTrack: Invalid value size in track.",this),t=!1);const n=this.times,s=this.values,r=n.length;r===0&&(console.error("THREE.KeyframeTrack: Track is empty.",this),t=!1);let o=null;for(let a=0;a!==r;a++){const c=n[a];if(typeof c=="number"&&isNaN(c)){console.error("THREE.KeyframeTrack: Time is not a valid number.",this,a,c),t=!1;break}if(o!==null&&o>c){console.error("THREE.KeyframeTrack: Out of order keys.",this,a,c,o),t=!1;break}o=c}if(s!==void 0&&Tw(s))for(let a=0,c=s.length;a!==c;++a){const l=s[a];if(isNaN(l)){console.error("THREE.KeyframeTrack: Value is not a valid number.",this,a,l),t=!1;break}}return t}optimize(){const t=this.times.slice(),e=this.values.slice(),n=this.getValueSize(),s=this.getInterpolation()===Yl,r=t.length-1;let o=1;for(let a=1;a<r;++a){let c=!1;const l=t[a],h=t[a+1];if(l!==h&&(a!==1||l!==t[0]))if(s)c=!0;else{const d=a*n,f=d-n,p=d+n;for(let v=0;v!==n;++v){const x=e[d+v];if(x!==e[f+v]||x!==e[p+v]){c=!0;break}}}if(c){if(a!==o){t[o]=t[a];const d=a*n,f=o*n;for(let p=0;p!==n;++p)e[f+p]=e[d+p]}++o}}if(r>0){t[o]=t[r];for(let a=r*n,c=o*n,l=0;l!==n;++l)e[c+l]=e[a+l];++o}return o!==t.length?(this.times=t.slice(0,o),this.values=e.slice(0,o*n)):(this.times=t,this.values=e),this}clone(){const t=this.times.slice(),e=this.values.slice(),n=this.constructor,s=new n(this.name,t,e);return s.createInterpolant=this.createInterpolant,s}}wi.prototype.TimeBufferType=Float32Array;wi.prototype.ValueBufferType=Float32Array;wi.prototype.DefaultInterpolation=ha;class uo extends wi{constructor(t,e,n){super(t,e,n)}}uo.prototype.ValueTypeName="bool";uo.prototype.ValueBufferType=Array;uo.prototype.DefaultInterpolation=ua;uo.prototype.InterpolantFactoryMethodLinear=void 0;uo.prototype.InterpolantFactoryMethodSmooth=void 0;class H_ extends wi{}H_.prototype.ValueTypeName="color";class Qr extends wi{}Qr.prototype.ValueTypeName="number";class ww extends Pa{constructor(t,e,n,s){super(t,e,n,s)}interpolate_(t,e,n,s){const r=this.resultBuffer,o=this.sampleValues,a=this.valueSize,c=(n-e)/(s-e);let l=t*a;for(let h=l+a;l!==h;l+=4)oi.slerpFlat(r,0,o,l-a,o,l,c);return r}}class to extends wi{InterpolantFactoryMethodLinear(t){return new ww(this.times,this.values,this.getValueSize(),t)}}to.prototype.ValueTypeName="quaternion";to.prototype.InterpolantFactoryMethodSmooth=void 0;class ho extends wi{constructor(t,e,n){super(t,e,n)}}ho.prototype.ValueTypeName="string";ho.prototype.ValueBufferType=Array;ho.prototype.DefaultInterpolation=ua;ho.prototype.InterpolantFactoryMethodLinear=void 0;ho.prototype.InterpolantFactoryMethodSmooth=void 0;class eo extends wi{}eo.prototype.ValueTypeName="vector";class zh{constructor(t="",e=-1,n=[],s=Sd){this.name=t,this.tracks=n,this.duration=e,this.blendMode=s,this.uuid=qn(),this.duration<0&&this.resetDuration()}static parse(t){const e=[],n=t.tracks,s=1/(t.fps||1);for(let o=0,a=n.length;o!==a;++o)e.push(Rw(n[o]).scale(s));const r=new this(t.name,t.duration,e,t.blendMode);return r.uuid=t.uuid,r}static toJSON(t){const e=[],n=t.tracks,s={name:t.name,duration:t.duration,tracks:e,uuid:t.uuid,blendMode:t.blendMode};for(let r=0,o=n.length;r!==o;++r)e.push(wi.toJSON(n[r]));return s}static CreateFromMorphTargetSequence(t,e,n,s){const r=e.length,o=[];for(let a=0;a<r;a++){let c=[],l=[];c.push((a+r-1)%r,a,(a+1)%r),l.push(0,1,0);const h=Sw(c);c=mm(c,1,h),l=mm(l,1,h),!s&&c[0]===0&&(c.push(r),l.push(l[0])),o.push(new Qr(".morphTargetInfluences["+e[a].name+"]",c,l).scale(1/n))}return new this(t,-1,o)}static findByName(t,e){let n=t;if(!Array.isArray(t)){const s=t;n=s.geometry&&s.geometry.animations||s.animations}for(let s=0;s<n.length;s++)if(n[s].name===e)return n[s];return null}static CreateClipsFromMorphTargetSequences(t,e,n){const s={},r=/^([\w-]*?)([\d]+)$/;for(let a=0,c=t.length;a<c;a++){const l=t[a],h=l.name.match(r);if(h&&h.length>1){const d=h[1];let f=s[d];f||(s[d]=f=[]),f.push(l)}}const o=[];for(const a in s)o.push(this.CreateFromMorphTargetSequence(a,s[a],e,n));return o}static parseAnimation(t,e){if(!t)return console.error("THREE.AnimationClip: No animation in JSONLoader data."),null;const n=function(d,f,p,v,x){if(p.length!==0){const m=[],_=[];k_(p,m,_,v),m.length!==0&&x.push(new d(f,m,_))}},s=[],r=t.name||"default",o=t.fps||30,a=t.blendMode;let c=t.length||-1;const l=t.hierarchy||[];for(let d=0;d<l.length;d++){const f=l[d].keys;if(!(!f||f.length===0))if(f[0].morphTargets){const p={};let v;for(v=0;v<f.length;v++)if(f[v].morphTargets)for(let x=0;x<f[v].morphTargets.length;x++)p[f[v].morphTargets[x]]=-1;for(const x in p){const m=[],_=[];for(let A=0;A!==f[v].morphTargets.length;++A){const S=f[v];m.push(S.time),_.push(S.morphTarget===x?1:0)}s.push(new Qr(".morphTargetInfluence["+x+"]",m,_))}c=p.length*o}else{const p=".bones["+e[d].name+"]";n(eo,p+".position",f,"pos",s),n(to,p+".quaternion",f,"rot",s),n(eo,p+".scale",f,"scl",s)}}return s.length===0?null:new this(r,c,s,a)}resetDuration(){const t=this.tracks;let e=0;for(let n=0,s=t.length;n!==s;++n){const r=this.tracks[n];e=Math.max(e,r.times[r.times.length-1])}return this.duration=e,this}trim(){for(let t=0;t<this.tracks.length;t++)this.tracks[t].trim(0,this.duration);return this}validate(){let t=!0;for(let e=0;e<this.tracks.length;e++)t=t&&this.tracks[e].validate();return t}optimize(){for(let t=0;t<this.tracks.length;t++)this.tracks[t].optimize();return this}clone(){const t=[];for(let e=0;e<this.tracks.length;e++)t.push(this.tracks[e].clone());return new this.constructor(this.name,this.duration,t,this.blendMode)}toJSON(){return this.constructor.toJSON(this)}}function bw(i){switch(i.toLowerCase()){case"scalar":case"double":case"float":case"number":case"integer":return Qr;case"vector":case"vector2":case"vector3":case"vector4":return eo;case"color":return H_;case"quaternion":return to;case"bool":case"boolean":return uo;case"string":return ho}throw new Error("THREE.KeyframeTrack: Unsupported typeName: "+i)}function Rw(i){if(i.type===void 0)throw new Error("THREE.KeyframeTrack: track type undefined, can not parse");const t=bw(i.type);if(i.times===void 0){const e=[],n=[];k_(i.keys,e,n,"value"),i.times=e,i.values=n}return t.parse!==void 0?t.parse(i):new t(i.name,i.times,i.values,i.interpolation)}const rs={enabled:!1,files:{},add:function(i,t){this.enabled!==!1&&(this.files[i]=t)},get:function(i){if(this.enabled!==!1)return this.files[i]},remove:function(i){delete this.files[i]},clear:function(){this.files={}}};class Iw{constructor(t,e,n){const s=this;let r=!1,o=0,a=0,c;const l=[];this.onStart=void 0,this.onLoad=t,this.onProgress=e,this.onError=n,this.itemStart=function(h){a++,r===!1&&s.onStart!==void 0&&s.onStart(h,o,a),r=!0},this.itemEnd=function(h){o++,s.onProgress!==void 0&&s.onProgress(h,o,a),o===a&&(r=!1,s.onLoad!==void 0&&s.onLoad())},this.itemError=function(h){s.onError!==void 0&&s.onError(h)},this.resolveURL=function(h){return c?c(h):h},this.setURLModifier=function(h){return c=h,this},this.addHandler=function(h,d){return l.push(h,d),this},this.removeHandler=function(h){const d=l.indexOf(h);return d!==-1&&l.splice(d,2),this},this.getHandler=function(h){for(let d=0,f=l.length;d<f;d+=2){const p=l[d],v=l[d+1];if(p.global&&(p.lastIndex=0),p.test(h))return v}return null}}}const Cw=new Iw;class fo{constructor(t){this.manager=t!==void 0?t:Cw,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={}}load(){}loadAsync(t,e){const n=this;return new Promise(function(s,r){n.load(t,s,e,r)})}parse(){}setCrossOrigin(t){return this.crossOrigin=t,this}setWithCredentials(t){return this.withCredentials=t,this}setPath(t){return this.path=t,this}setResourcePath(t){return this.resourcePath=t,this}setRequestHeader(t){return this.requestHeader=t,this}}fo.DEFAULT_MATERIAL_NAME="__DEFAULT";const Ni={};class Pw extends Error{constructor(t,e){super(t),this.response=e}}class G_ extends fo{constructor(t){super(t)}load(t,e,n,s){t===void 0&&(t=""),this.path!==void 0&&(t=this.path+t),t=this.manager.resolveURL(t);const r=rs.get(t);if(r!==void 0)return this.manager.itemStart(t),setTimeout(()=>{e&&e(r),this.manager.itemEnd(t)},0),r;if(Ni[t]!==void 0){Ni[t].push({onLoad:e,onProgress:n,onError:s});return}Ni[t]=[],Ni[t].push({onLoad:e,onProgress:n,onError:s});const o=new Request(t,{headers:new Headers(this.requestHeader),credentials:this.withCredentials?"include":"same-origin"}),a=this.mimeType,c=this.responseType;fetch(o).then(l=>{if(l.status===200||l.status===0){if(l.status===0&&console.warn("THREE.FileLoader: HTTP Status 0 received."),typeof ReadableStream>"u"||l.body===void 0||l.body.getReader===void 0)return l;const h=Ni[t],d=l.body.getReader(),f=l.headers.get("X-File-Size")||l.headers.get("Content-Length"),p=f?parseInt(f):0,v=p!==0;let x=0;const m=new ReadableStream({start(_){A();function A(){d.read().then(({done:S,value:b})=>{if(S)_.close();else{x+=b.byteLength;const F=new ProgressEvent("progress",{lengthComputable:v,loaded:x,total:p});for(let N=0,M=h.length;N<M;N++){const w=h[N];w.onProgress&&w.onProgress(F)}_.enqueue(b),A()}},S=>{_.error(S)})}}});return new Response(m)}else throw new Pw(`fetch for "${l.url}" responded with ${l.status}: ${l.statusText}`,l)}).then(l=>{switch(c){case"arraybuffer":return l.arrayBuffer();case"blob":return l.blob();case"document":return l.text().then(h=>new DOMParser().parseFromString(h,a));case"json":return l.json();default:if(a===void 0)return l.text();{const d=/charset="?([^;"\s]*)"?/i.exec(a),f=d&&d[1]?d[1].toLowerCase():void 0,p=new TextDecoder(f);return l.arrayBuffer().then(v=>p.decode(v))}}}).then(l=>{rs.add(t,l);const h=Ni[t];delete Ni[t];for(let d=0,f=h.length;d<f;d++){const p=h[d];p.onLoad&&p.onLoad(l)}}).catch(l=>{const h=Ni[t];if(h===void 0)throw this.manager.itemError(t),l;delete Ni[t];for(let d=0,f=h.length;d<f;d++){const p=h[d];p.onError&&p.onError(l)}this.manager.itemError(t)}).finally(()=>{this.manager.itemEnd(t)}),this.manager.itemStart(t)}setResponseType(t){return this.responseType=t,this}setMimeType(t){return this.mimeType=t,this}}class Dw extends fo{constructor(t){super(t)}load(t,e,n,s){this.path!==void 0&&(t=this.path+t),t=this.manager.resolveURL(t);const r=this,o=rs.get(t);if(o!==void 0)return r.manager.itemStart(t),setTimeout(function(){e&&e(o),r.manager.itemEnd(t)},0),o;const a=da("img");function c(){h(),rs.add(t,this),e&&e(this),r.manager.itemEnd(t)}function l(d){h(),s&&s(d),r.manager.itemError(t),r.manager.itemEnd(t)}function h(){a.removeEventListener("load",c,!1),a.removeEventListener("error",l,!1)}return a.addEventListener("load",c,!1),a.addEventListener("error",l,!1),t.slice(0,5)!=="data:"&&this.crossOrigin!==void 0&&(a.crossOrigin=this.crossOrigin),r.manager.itemStart(t),a.src=t,a}}class Lw extends fo{constructor(t){super(t)}load(t,e,n,s){const r=new Ze,o=new Dw(this.manager);return o.setCrossOrigin(this.crossOrigin),o.setPath(this.path),o.load(t,function(a){r.image=a,r.needsUpdate=!0,e!==void 0&&e(r)},n,s),r}}class Da extends Me{constructor(t,e=1){super(),this.isLight=!0,this.type="Light",this.color=new It(t),this.intensity=e}dispose(){}copy(t,e){return super.copy(t,e),this.color.copy(t.color),this.intensity=t.intensity,this}toJSON(t){const e=super.toJSON(t);return e.object.color=this.color.getHex(),e.object.intensity=this.intensity,this.groundColor!==void 0&&(e.object.groundColor=this.groundColor.getHex()),this.distance!==void 0&&(e.object.distance=this.distance),this.angle!==void 0&&(e.object.angle=this.angle),this.decay!==void 0&&(e.object.decay=this.decay),this.penumbra!==void 0&&(e.object.penumbra=this.penumbra),this.shadow!==void 0&&(e.object.shadow=this.shadow.toJSON()),this.target!==void 0&&(e.object.target=this.target.uuid),e}}class G2 extends Da{constructor(t,e,n){super(t,n),this.isHemisphereLight=!0,this.type="HemisphereLight",this.position.copy(Me.DEFAULT_UP),this.updateMatrix(),this.groundColor=new It(e)}copy(t,e){return super.copy(t,e),this.groundColor.copy(t.groundColor),this}}const Du=new Gt,gm=new O,_m=new O;class Fd{constructor(t){this.camera=t,this.intensity=1,this.bias=0,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new dt(512,512),this.map=null,this.mapPass=null,this.matrix=new Gt,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new Rd,this._frameExtents=new dt(1,1),this._viewportCount=1,this._viewports=[new ge(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(t){const e=this.camera,n=this.matrix;gm.setFromMatrixPosition(t.matrixWorld),e.position.copy(gm),_m.setFromMatrixPosition(t.target.matrixWorld),e.lookAt(_m),e.updateMatrixWorld(),Du.multiplyMatrices(e.projectionMatrix,e.matrixWorldInverse),this._frustum.setFromProjectionMatrix(Du),n.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),n.multiply(Du)}getViewport(t){return this._viewports[t]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(t){return this.camera=t.camera.clone(),this.intensity=t.intensity,this.bias=t.bias,this.radius=t.radius,this.mapSize.copy(t.mapSize),this}clone(){return new this.constructor().copy(this)}toJSON(){const t={};return this.intensity!==1&&(t.intensity=this.intensity),this.bias!==0&&(t.bias=this.bias),this.normalBias!==0&&(t.normalBias=this.normalBias),this.radius!==1&&(t.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(t.mapSize=this.mapSize.toArray()),t.camera=this.camera.toJSON(!1).object,delete t.camera.matrix,t}}class Nw extends Fd{constructor(){super(new Pn(50,1,.5,500)),this.isSpotLightShadow=!0,this.focus=1}updateMatrices(t){const e=this.camera,n=Jr*2*t.angle*this.focus,s=this.mapSize.width/this.mapSize.height,r=t.distance||e.far;(n!==e.fov||s!==e.aspect||r!==e.far)&&(e.fov=n,e.aspect=s,e.far=r,e.updateProjectionMatrix()),super.updateMatrices(t)}copy(t){return super.copy(t),this.focus=t.focus,this}}class Uw extends Da{constructor(t,e,n=0,s=Math.PI/3,r=0,o=2){super(t,e),this.isSpotLight=!0,this.type="SpotLight",this.position.copy(Me.DEFAULT_UP),this.updateMatrix(),this.target=new Me,this.distance=n,this.angle=s,this.penumbra=r,this.decay=o,this.map=null,this.shadow=new Nw}get power(){return this.intensity*Math.PI}set power(t){this.intensity=t/Math.PI}dispose(){this.shadow.dispose()}copy(t,e){return super.copy(t,e),this.distance=t.distance,this.angle=t.angle,this.penumbra=t.penumbra,this.decay=t.decay,this.target=t.target.clone(),this.shadow=t.shadow.clone(),this}}const vm=new Gt,zo=new O,Lu=new O;class Ow extends Fd{constructor(){super(new Pn(90,1,.5,500)),this.isPointLightShadow=!0,this._frameExtents=new dt(4,2),this._viewportCount=6,this._viewports=[new ge(2,1,1,1),new ge(0,1,1,1),new ge(3,1,1,1),new ge(1,1,1,1),new ge(3,0,1,1),new ge(1,0,1,1)],this._cubeDirections=[new O(1,0,0),new O(-1,0,0),new O(0,0,1),new O(0,0,-1),new O(0,1,0),new O(0,-1,0)],this._cubeUps=[new O(0,1,0),new O(0,1,0),new O(0,1,0),new O(0,1,0),new O(0,0,1),new O(0,0,-1)]}updateMatrices(t,e=0){const n=this.camera,s=this.matrix,r=t.distance||n.far;r!==n.far&&(n.far=r,n.updateProjectionMatrix()),zo.setFromMatrixPosition(t.matrixWorld),n.position.copy(zo),Lu.copy(n.position),Lu.add(this._cubeDirections[e]),n.up.copy(this._cubeUps[e]),n.lookAt(Lu),n.updateMatrixWorld(),s.makeTranslation(-zo.x,-zo.y,-zo.z),vm.multiplyMatrices(n.projectionMatrix,n.matrixWorldInverse),this._frustum.setFromProjectionMatrix(vm)}}class Fw extends Da{constructor(t,e,n=0,s=2){super(t,e),this.isPointLight=!0,this.type="PointLight",this.distance=n,this.decay=s,this.shadow=new Ow}get power(){return this.intensity*4*Math.PI}set power(t){this.intensity=t/(4*Math.PI)}dispose(){this.shadow.dispose()}copy(t,e){return super.copy(t,e),this.distance=t.distance,this.decay=t.decay,this.shadow=t.shadow.clone(),this}}class Vw extends Fd{constructor(){super(new Id(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}}class Bw extends Da{constructor(t,e){super(t,e),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(Me.DEFAULT_UP),this.updateMatrix(),this.target=new Me,this.shadow=new Vw}dispose(){this.shadow.dispose()}copy(t){return super.copy(t),this.target=t.target.clone(),this.shadow=t.shadow.clone(),this}}class W2 extends Da{constructor(t,e){super(t,e),this.isAmbientLight=!0,this.type="AmbientLight"}}class ia{static decodeText(t){if(console.warn("THREE.LoaderUtils: decodeText() has been deprecated with r165 and will be removed with r175. Use TextDecoder instead."),typeof TextDecoder<"u")return new TextDecoder().decode(t);let e="";for(let n=0,s=t.length;n<s;n++)e+=String.fromCharCode(t[n]);try{return decodeURIComponent(escape(e))}catch{return e}}static extractUrlBase(t){const e=t.lastIndexOf("/");return e===-1?"./":t.slice(0,e+1)}static resolveURL(t,e){return typeof t!="string"||t===""?"":(/^https?:\/\//i.test(e)&&/^\//.test(t)&&(e=e.replace(/(^https?:\/\/[^\/]+).*/i,"$1")),/^(https?:)?\/\//i.test(t)||/^data:.*,.*$/i.test(t)||/^blob:.*$/i.test(t)?t:e+t)}}class kw extends fo{constructor(t){super(t),this.isImageBitmapLoader=!0,typeof createImageBitmap>"u"&&console.warn("THREE.ImageBitmapLoader: createImageBitmap() not supported."),typeof fetch>"u"&&console.warn("THREE.ImageBitmapLoader: fetch() not supported."),this.options={premultiplyAlpha:"none"}}setOptions(t){return this.options=t,this}load(t,e,n,s){t===void 0&&(t=""),this.path!==void 0&&(t=this.path+t),t=this.manager.resolveURL(t);const r=this,o=rs.get(t);if(o!==void 0){if(r.manager.itemStart(t),o.then){o.then(l=>{e&&e(l),r.manager.itemEnd(t)}).catch(l=>{s&&s(l)});return}return setTimeout(function(){e&&e(o),r.manager.itemEnd(t)},0),o}const a={};a.credentials=this.crossOrigin==="anonymous"?"same-origin":"include",a.headers=this.requestHeader;const c=fetch(t,a).then(function(l){return l.blob()}).then(function(l){return createImageBitmap(l,Object.assign(r.options,{colorSpaceConversion:"none"}))}).then(function(l){return rs.add(t,l),e&&e(l),r.manager.itemEnd(t),l}).catch(function(l){s&&s(l),rs.remove(t),r.manager.itemError(t),r.manager.itemEnd(t)});rs.add(t,c),r.manager.itemStart(t)}}class zw{constructor(t,e,n){this.binding=t,this.valueSize=n;let s,r,o;switch(e){case"quaternion":s=this._slerp,r=this._slerpAdditive,o=this._setAdditiveIdentityQuaternion,this.buffer=new Float64Array(n*6),this._workIndex=5;break;case"string":case"bool":s=this._select,r=this._select,o=this._setAdditiveIdentityOther,this.buffer=new Array(n*5);break;default:s=this._lerp,r=this._lerpAdditive,o=this._setAdditiveIdentityNumeric,this.buffer=new Float64Array(n*5)}this._mixBufferRegion=s,this._mixBufferRegionAdditive=r,this._setIdentity=o,this._origIndex=3,this._addIndex=4,this.cumulativeWeight=0,this.cumulativeWeightAdditive=0,this.useCount=0,this.referenceCount=0}accumulate(t,e){const n=this.buffer,s=this.valueSize,r=t*s+s;let o=this.cumulativeWeight;if(o===0){for(let a=0;a!==s;++a)n[r+a]=n[a];o=e}else{o+=e;const a=e/o;this._mixBufferRegion(n,r,0,a,s)}this.cumulativeWeight=o}accumulateAdditive(t){const e=this.buffer,n=this.valueSize,s=n*this._addIndex;this.cumulativeWeightAdditive===0&&this._setIdentity(),this._mixBufferRegionAdditive(e,s,0,t,n),this.cumulativeWeightAdditive+=t}apply(t){const e=this.valueSize,n=this.buffer,s=t*e+e,r=this.cumulativeWeight,o=this.cumulativeWeightAdditive,a=this.binding;if(this.cumulativeWeight=0,this.cumulativeWeightAdditive=0,r<1){const c=e*this._origIndex;this._mixBufferRegion(n,s,c,1-r,e)}o>0&&this._mixBufferRegionAdditive(n,s,this._addIndex*e,1,e);for(let c=e,l=e+e;c!==l;++c)if(n[c]!==n[c+e]){a.setValue(n,s);break}}saveOriginalState(){const t=this.binding,e=this.buffer,n=this.valueSize,s=n*this._origIndex;t.getValue(e,s);for(let r=n,o=s;r!==o;++r)e[r]=e[s+r%n];this._setIdentity(),this.cumulativeWeight=0,this.cumulativeWeightAdditive=0}restoreOriginalState(){const t=this.valueSize*3;this.binding.setValue(this.buffer,t)}_setAdditiveIdentityNumeric(){const t=this._addIndex*this.valueSize,e=t+this.valueSize;for(let n=t;n<e;n++)this.buffer[n]=0}_setAdditiveIdentityQuaternion(){this._setAdditiveIdentityNumeric(),this.buffer[this._addIndex*this.valueSize+3]=1}_setAdditiveIdentityOther(){const t=this._origIndex*this.valueSize,e=this._addIndex*this.valueSize;for(let n=0;n<this.valueSize;n++)this.buffer[e+n]=this.buffer[t+n]}_select(t,e,n,s,r){if(s>=.5)for(let o=0;o!==r;++o)t[e+o]=t[n+o]}_slerp(t,e,n,s){oi.slerpFlat(t,e,t,e,t,n,s)}_slerpAdditive(t,e,n,s,r){const o=this._workIndex*r;oi.multiplyQuaternionsFlat(t,o,t,e,t,n),oi.slerpFlat(t,e,t,e,t,o,s)}_lerp(t,e,n,s,r){const o=1-s;for(let a=0;a!==r;++a){const c=e+a;t[c]=t[c]*o+t[n+a]*s}}_lerpAdditive(t,e,n,s,r){for(let o=0;o!==r;++o){const a=e+o;t[a]=t[a]+t[n+o]*s}}}const Vd="\\[\\]\\.:\\/",Hw=new RegExp("["+Vd+"]","g"),Bd="[^"+Vd+"]",Gw="[^"+Vd.replace("\\.","")+"]",Ww=/((?:WC+[\/:])*)/.source.replace("WC",Bd),Xw=/(WCOD+)?/.source.replace("WCOD",Gw),qw=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",Bd),jw=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",Bd),Kw=new RegExp("^"+Ww+Xw+qw+jw+"$"),$w=["material","materials","bones","map"];class Yw{constructor(t,e,n){const s=n||_e.parseTrackName(e);this._targetGroup=t,this._bindings=t.subscribe_(e,s)}getValue(t,e){this.bind();const n=this._targetGroup.nCachedObjects_,s=this._bindings[n];s!==void 0&&s.getValue(t,e)}setValue(t,e){const n=this._bindings;for(let s=this._targetGroup.nCachedObjects_,r=n.length;s!==r;++s)n[s].setValue(t,e)}bind(){const t=this._bindings;for(let e=this._targetGroup.nCachedObjects_,n=t.length;e!==n;++e)t[e].bind()}unbind(){const t=this._bindings;for(let e=this._targetGroup.nCachedObjects_,n=t.length;e!==n;++e)t[e].unbind()}}class _e{constructor(t,e,n){this.path=e,this.parsedPath=n||_e.parseTrackName(e),this.node=_e.findNode(t,this.parsedPath.nodeName),this.rootNode=t,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(t,e,n){return t&&t.isAnimationObjectGroup?new _e.Composite(t,e,n):new _e(t,e,n)}static sanitizeNodeName(t){return t.replace(/\s/g,"_").replace(Hw,"")}static parseTrackName(t){const e=Kw.exec(t);if(e===null)throw new Error("PropertyBinding: Cannot parse trackName: "+t);const n={nodeName:e[2],objectName:e[3],objectIndex:e[4],propertyName:e[5],propertyIndex:e[6]},s=n.nodeName&&n.nodeName.lastIndexOf(".");if(s!==void 0&&s!==-1){const r=n.nodeName.substring(s+1);$w.indexOf(r)!==-1&&(n.nodeName=n.nodeName.substring(0,s),n.objectName=r)}if(n.propertyName===null||n.propertyName.length===0)throw new Error("PropertyBinding: can not parse propertyName from trackName: "+t);return n}static findNode(t,e){if(e===void 0||e===""||e==="."||e===-1||e===t.name||e===t.uuid)return t;if(t.skeleton){const n=t.skeleton.getBoneByName(e);if(n!==void 0)return n}if(t.children){const n=function(r){for(let o=0;o<r.length;o++){const a=r[o];if(a.name===e||a.uuid===e)return a;const c=n(a.children);if(c)return c}return null},s=n(t.children);if(s)return s}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(t,e){t[e]=this.targetObject[this.propertyName]}_getValue_array(t,e){const n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)t[e++]=n[s]}_getValue_arrayElement(t,e){t[e]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(t,e){this.resolvedProperty.toArray(t,e)}_setValue_direct(t,e){this.targetObject[this.propertyName]=t[e]}_setValue_direct_setNeedsUpdate(t,e){this.targetObject[this.propertyName]=t[e],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(t,e){this.targetObject[this.propertyName]=t[e],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(t,e){const n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)n[s]=t[e++]}_setValue_array_setNeedsUpdate(t,e){const n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)n[s]=t[e++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(t,e){const n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)n[s]=t[e++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(t,e){this.resolvedProperty[this.propertyIndex]=t[e]}_setValue_arrayElement_setNeedsUpdate(t,e){this.resolvedProperty[this.propertyIndex]=t[e],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(t,e){this.resolvedProperty[this.propertyIndex]=t[e],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(t,e){this.resolvedProperty.fromArray(t,e)}_setValue_fromArray_setNeedsUpdate(t,e){this.resolvedProperty.fromArray(t,e),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(t,e){this.resolvedProperty.fromArray(t,e),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(t,e){this.bind(),this.getValue(t,e)}_setValue_unbound(t,e){this.bind(),this.setValue(t,e)}bind(){let t=this.node;const e=this.parsedPath,n=e.objectName,s=e.propertyName;let r=e.propertyIndex;if(t||(t=_e.findNode(this.rootNode,e.nodeName),this.node=t),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!t){console.warn("THREE.PropertyBinding: No target node found for track: "+this.path+".");return}if(n){let l=e.objectIndex;switch(n){case"materials":if(!t.material){console.error("THREE.PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!t.material.materials){console.error("THREE.PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}t=t.material.materials;break;case"bones":if(!t.skeleton){console.error("THREE.PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}t=t.skeleton.bones;for(let h=0;h<t.length;h++)if(t[h].name===l){l=h;break}break;case"map":if("map"in t){t=t.map;break}if(!t.material){console.error("THREE.PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!t.material.map){console.error("THREE.PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}t=t.material.map;break;default:if(t[n]===void 0){console.error("THREE.PropertyBinding: Can not bind to objectName of node undefined.",this);return}t=t[n]}if(l!==void 0){if(t[l]===void 0){console.error("THREE.PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,t);return}t=t[l]}}const o=t[s];if(o===void 0){const l=e.nodeName;console.error("THREE.PropertyBinding: Trying to update property for track: "+l+"."+s+" but it wasn't found.",t);return}let a=this.Versioning.None;this.targetObject=t,t.needsUpdate!==void 0?a=this.Versioning.NeedsUpdate:t.matrixWorldNeedsUpdate!==void 0&&(a=this.Versioning.MatrixWorldNeedsUpdate);let c=this.BindingType.Direct;if(r!==void 0){if(s==="morphTargetInfluences"){if(!t.geometry){console.error("THREE.PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!t.geometry.morphAttributes){console.error("THREE.PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}t.morphTargetDictionary[r]!==void 0&&(r=t.morphTargetDictionary[r])}c=this.BindingType.ArrayElement,this.resolvedProperty=o,this.propertyIndex=r}else o.fromArray!==void 0&&o.toArray!==void 0?(c=this.BindingType.HasFromToArray,this.resolvedProperty=o):Array.isArray(o)?(c=this.BindingType.EntireArray,this.resolvedProperty=o):this.propertyName=s;this.getValue=this.GetterByBindingType[c],this.setValue=this.SetterByBindingTypeAndVersioning[c][a]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}}_e.Composite=Yw;_e.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3};_e.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2};_e.prototype.GetterByBindingType=[_e.prototype._getValue_direct,_e.prototype._getValue_array,_e.prototype._getValue_arrayElement,_e.prototype._getValue_toArray];_e.prototype.SetterByBindingTypeAndVersioning=[[_e.prototype._setValue_direct,_e.prototype._setValue_direct_setNeedsUpdate,_e.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[_e.prototype._setValue_array,_e.prototype._setValue_array_setNeedsUpdate,_e.prototype._setValue_array_setMatrixWorldNeedsUpdate],[_e.prototype._setValue_arrayElement,_e.prototype._setValue_arrayElement_setNeedsUpdate,_e.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[_e.prototype._setValue_fromArray,_e.prototype._setValue_fromArray_setNeedsUpdate,_e.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];class Jw{constructor(t,e,n=null,s=e.blendMode){this._mixer=t,this._clip=e,this._localRoot=n,this.blendMode=s;const r=e.tracks,o=r.length,a=new Array(o),c={endingStart:Ur,endingEnd:Ur};for(let l=0;l!==o;++l){const h=r[l].createInterpolant(null);a[l]=h,h.settings=c}this._interpolantSettings=c,this._interpolants=a,this._propertyBindings=new Array(o),this._cacheIndex=null,this._byClipCacheIndex=null,this._timeScaleInterpolant=null,this._weightInterpolant=null,this.loop=qy,this._loopCount=-1,this._startTime=null,this.time=0,this.timeScale=1,this._effectiveTimeScale=1,this.weight=1,this._effectiveWeight=1,this.repetitions=1/0,this.paused=!1,this.enabled=!0,this.clampWhenFinished=!1,this.zeroSlopeAtStart=!0,this.zeroSlopeAtEnd=!0}play(){return this._mixer._activateAction(this),this}stop(){return this._mixer._deactivateAction(this),this.reset()}reset(){return this.paused=!1,this.enabled=!0,this.time=0,this._loopCount=-1,this._startTime=null,this.stopFading().stopWarping()}isRunning(){return this.enabled&&!this.paused&&this.timeScale!==0&&this._startTime===null&&this._mixer._isActiveAction(this)}isScheduled(){return this._mixer._isActiveAction(this)}startAt(t){return this._startTime=t,this}setLoop(t,e){return this.loop=t,this.repetitions=e,this}setEffectiveWeight(t){return this.weight=t,this._effectiveWeight=this.enabled?t:0,this.stopFading()}getEffectiveWeight(){return this._effectiveWeight}fadeIn(t){return this._scheduleFading(t,0,1)}fadeOut(t){return this._scheduleFading(t,1,0)}crossFadeFrom(t,e,n){if(t.fadeOut(e),this.fadeIn(e),n){const s=this._clip.duration,r=t._clip.duration,o=r/s,a=s/r;t.warp(1,o,e),this.warp(a,1,e)}return this}crossFadeTo(t,e,n){return t.crossFadeFrom(this,e,n)}stopFading(){const t=this._weightInterpolant;return t!==null&&(this._weightInterpolant=null,this._mixer._takeBackControlInterpolant(t)),this}setEffectiveTimeScale(t){return this.timeScale=t,this._effectiveTimeScale=this.paused?0:t,this.stopWarping()}getEffectiveTimeScale(){return this._effectiveTimeScale}setDuration(t){return this.timeScale=this._clip.duration/t,this.stopWarping()}syncWith(t){return this.time=t.time,this.timeScale=t.timeScale,this.stopWarping()}halt(t){return this.warp(this._effectiveTimeScale,0,t)}warp(t,e,n){const s=this._mixer,r=s.time,o=this.timeScale;let a=this._timeScaleInterpolant;a===null&&(a=s._lendControlInterpolant(),this._timeScaleInterpolant=a);const c=a.parameterPositions,l=a.sampleValues;return c[0]=r,c[1]=r+n,l[0]=t/o,l[1]=e/o,this}stopWarping(){const t=this._timeScaleInterpolant;return t!==null&&(this._timeScaleInterpolant=null,this._mixer._takeBackControlInterpolant(t)),this}getMixer(){return this._mixer}getClip(){return this._clip}getRoot(){return this._localRoot||this._mixer._root}_update(t,e,n,s){if(!this.enabled){this._updateWeight(t);return}const r=this._startTime;if(r!==null){const c=(t-r)*n;c<0||n===0?e=0:(this._startTime=null,e=n*c)}e*=this._updateTimeScale(t);const o=this._updateTime(e),a=this._updateWeight(t);if(a>0){const c=this._interpolants,l=this._propertyBindings;switch(this.blendMode){case Ky:for(let h=0,d=c.length;h!==d;++h)c[h].evaluate(o),l[h].accumulateAdditive(a);break;case Sd:default:for(let h=0,d=c.length;h!==d;++h)c[h].evaluate(o),l[h].accumulate(s,a)}}}_updateWeight(t){let e=0;if(this.enabled){e=this.weight;const n=this._weightInterpolant;if(n!==null){const s=n.evaluate(t)[0];e*=s,t>n.parameterPositions[1]&&(this.stopFading(),s===0&&(this.enabled=!1))}}return this._effectiveWeight=e,e}_updateTimeScale(t){let e=0;if(!this.paused){e=this.timeScale;const n=this._timeScaleInterpolant;if(n!==null){const s=n.evaluate(t)[0];e*=s,t>n.parameterPositions[1]&&(this.stopWarping(),e===0?this.paused=!0:this.timeScale=e)}}return this._effectiveTimeScale=e,e}_updateTime(t){const e=this._clip.duration,n=this.loop;let s=this.time+t,r=this._loopCount;const o=n===jy;if(t===0)return r===-1?s:o&&(r&1)===1?e-s:s;if(n===Xy){r===-1&&(this._loopCount=0,this._setEndings(!0,!0,!1));t:{if(s>=e)s=e;else if(s<0)s=0;else{this.time=s;break t}this.clampWhenFinished?this.paused=!0:this.enabled=!1,this.time=s,this._mixer.dispatchEvent({type:"finished",action:this,direction:t<0?-1:1})}}else{if(r===-1&&(t>=0?(r=0,this._setEndings(!0,this.repetitions===0,o)):this._setEndings(this.repetitions===0,!0,o)),s>=e||s<0){const a=Math.floor(s/e);s-=e*a,r+=Math.abs(a);const c=this.repetitions-r;if(c<=0)this.clampWhenFinished?this.paused=!0:this.enabled=!1,s=t>0?e:0,this.time=s,this._mixer.dispatchEvent({type:"finished",action:this,direction:t>0?1:-1});else{if(c===1){const l=t<0;this._setEndings(l,!l,o)}else this._setEndings(!1,!1,o);this._loopCount=r,this.time=s,this._mixer.dispatchEvent({type:"loop",action:this,loopDelta:a})}}else this.time=s;if(o&&(r&1)===1)return e-s}return s}_setEndings(t,e,n){const s=this._interpolantSettings;n?(s.endingStart=Or,s.endingEnd=Or):(t?s.endingStart=this.zeroSlopeAtStart?Or:Ur:s.endingStart=Jc,e?s.endingEnd=this.zeroSlopeAtEnd?Or:Ur:s.endingEnd=Jc)}_scheduleFading(t,e,n){const s=this._mixer,r=s.time;let o=this._weightInterpolant;o===null&&(o=s._lendControlInterpolant(),this._weightInterpolant=o);const a=o.parameterPositions,c=o.sampleValues;return a[0]=r,c[0]=e,a[1]=r+t,c[1]=n,this}}const Zw=new Float32Array(1);class Qw extends Ms{constructor(t){super(),this._root=t,this._initMemoryManager(),this._accuIndex=0,this.time=0,this.timeScale=1}_bindAction(t,e){const n=t._localRoot||this._root,s=t._clip.tracks,r=s.length,o=t._propertyBindings,a=t._interpolants,c=n.uuid,l=this._bindingsByRootAndName;let h=l[c];h===void 0&&(h={},l[c]=h);for(let d=0;d!==r;++d){const f=s[d],p=f.name;let v=h[p];if(v!==void 0)++v.referenceCount,o[d]=v;else{if(v=o[d],v!==void 0){v._cacheIndex===null&&(++v.referenceCount,this._addInactiveBinding(v,c,p));continue}const x=e&&e._propertyBindings[d].binding.parsedPath;v=new zw(_e.create(n,p,x),f.ValueTypeName,f.getValueSize()),++v.referenceCount,this._addInactiveBinding(v,c,p),o[d]=v}a[d].resultBuffer=v.buffer}}_activateAction(t){if(!this._isActiveAction(t)){if(t._cacheIndex===null){const n=(t._localRoot||this._root).uuid,s=t._clip.uuid,r=this._actionsByClip[s];this._bindAction(t,r&&r.knownActions[0]),this._addInactiveAction(t,s,n)}const e=t._propertyBindings;for(let n=0,s=e.length;n!==s;++n){const r=e[n];r.useCount++===0&&(this._lendBinding(r),r.saveOriginalState())}this._lendAction(t)}}_deactivateAction(t){if(this._isActiveAction(t)){const e=t._propertyBindings;for(let n=0,s=e.length;n!==s;++n){const r=e[n];--r.useCount===0&&(r.restoreOriginalState(),this._takeBackBinding(r))}this._takeBackAction(t)}}_initMemoryManager(){this._actions=[],this._nActiveActions=0,this._actionsByClip={},this._bindings=[],this._nActiveBindings=0,this._bindingsByRootAndName={},this._controlInterpolants=[],this._nActiveControlInterpolants=0;const t=this;this.stats={actions:{get total(){return t._actions.length},get inUse(){return t._nActiveActions}},bindings:{get total(){return t._bindings.length},get inUse(){return t._nActiveBindings}},controlInterpolants:{get total(){return t._controlInterpolants.length},get inUse(){return t._nActiveControlInterpolants}}}}_isActiveAction(t){const e=t._cacheIndex;return e!==null&&e<this._nActiveActions}_addInactiveAction(t,e,n){const s=this._actions,r=this._actionsByClip;let o=r[e];if(o===void 0)o={knownActions:[t],actionByRoot:{}},t._byClipCacheIndex=0,r[e]=o;else{const a=o.knownActions;t._byClipCacheIndex=a.length,a.push(t)}t._cacheIndex=s.length,s.push(t),o.actionByRoot[n]=t}_removeInactiveAction(t){const e=this._actions,n=e[e.length-1],s=t._cacheIndex;n._cacheIndex=s,e[s]=n,e.pop(),t._cacheIndex=null;const r=t._clip.uuid,o=this._actionsByClip,a=o[r],c=a.knownActions,l=c[c.length-1],h=t._byClipCacheIndex;l._byClipCacheIndex=h,c[h]=l,c.pop(),t._byClipCacheIndex=null;const d=a.actionByRoot,f=(t._localRoot||this._root).uuid;delete d[f],c.length===0&&delete o[r],this._removeInactiveBindingsForAction(t)}_removeInactiveBindingsForAction(t){const e=t._propertyBindings;for(let n=0,s=e.length;n!==s;++n){const r=e[n];--r.referenceCount===0&&this._removeInactiveBinding(r)}}_lendAction(t){const e=this._actions,n=t._cacheIndex,s=this._nActiveActions++,r=e[s];t._cacheIndex=s,e[s]=t,r._cacheIndex=n,e[n]=r}_takeBackAction(t){const e=this._actions,n=t._cacheIndex,s=--this._nActiveActions,r=e[s];t._cacheIndex=s,e[s]=t,r._cacheIndex=n,e[n]=r}_addInactiveBinding(t,e,n){const s=this._bindingsByRootAndName,r=this._bindings;let o=s[e];o===void 0&&(o={},s[e]=o),o[n]=t,t._cacheIndex=r.length,r.push(t)}_removeInactiveBinding(t){const e=this._bindings,n=t.binding,s=n.rootNode.uuid,r=n.path,o=this._bindingsByRootAndName,a=o[s],c=e[e.length-1],l=t._cacheIndex;c._cacheIndex=l,e[l]=c,e.pop(),delete a[r],Object.keys(a).length===0&&delete o[s]}_lendBinding(t){const e=this._bindings,n=t._cacheIndex,s=this._nActiveBindings++,r=e[s];t._cacheIndex=s,e[s]=t,r._cacheIndex=n,e[n]=r}_takeBackBinding(t){const e=this._bindings,n=t._cacheIndex,s=--this._nActiveBindings,r=e[s];t._cacheIndex=s,e[s]=t,r._cacheIndex=n,e[n]=r}_lendControlInterpolant(){const t=this._controlInterpolants,e=this._nActiveControlInterpolants++;let n=t[e];return n===void 0&&(n=new z_(new Float32Array(2),new Float32Array(2),1,Zw),n.__cacheIndex=e,t[e]=n),n}_takeBackControlInterpolant(t){const e=this._controlInterpolants,n=t.__cacheIndex,s=--this._nActiveControlInterpolants,r=e[s];t.__cacheIndex=s,e[s]=t,r.__cacheIndex=n,e[n]=r}clipAction(t,e,n){const s=e||this._root,r=s.uuid;let o=typeof t=="string"?zh.findByName(s,t):t;const a=o!==null?o.uuid:t,c=this._actionsByClip[a];let l=null;if(n===void 0&&(o!==null?n=o.blendMode:n=Sd),c!==void 0){const d=c.actionByRoot[r];if(d!==void 0&&d.blendMode===n)return d;l=c.knownActions[0],o===null&&(o=l._clip)}if(o===null)return null;const h=new Jw(this,o,e,n);return this._bindAction(h,l),this._addInactiveAction(h,a,r),h}existingAction(t,e){const n=e||this._root,s=n.uuid,r=typeof t=="string"?zh.findByName(n,t):t,o=r?r.uuid:t,a=this._actionsByClip[o];return a!==void 0&&a.actionByRoot[s]||null}stopAllAction(){const t=this._actions,e=this._nActiveActions;for(let n=e-1;n>=0;--n)t[n].stop();return this}update(t){t*=this.timeScale;const e=this._actions,n=this._nActiveActions,s=this.time+=t,r=Math.sign(t),o=this._accuIndex^=1;for(let l=0;l!==n;++l)e[l]._update(s,t,r,o);const a=this._bindings,c=this._nActiveBindings;for(let l=0;l!==c;++l)a[l].apply(o);return this}setTime(t){this.time=0;for(let e=0;e<this._actions.length;e++)this._actions[e].time=0;return this.update(t)}getRoot(){return this._root}uncacheClip(t){const e=this._actions,n=t.uuid,s=this._actionsByClip,r=s[n];if(r!==void 0){const o=r.knownActions;for(let a=0,c=o.length;a!==c;++a){const l=o[a];this._deactivateAction(l);const h=l._cacheIndex,d=e[e.length-1];l._cacheIndex=null,l._byClipCacheIndex=null,d._cacheIndex=h,e[h]=d,e.pop(),this._removeInactiveBindingsForAction(l)}delete s[n]}}uncacheRoot(t){const e=t.uuid,n=this._actionsByClip;for(const o in n){const a=n[o].actionByRoot,c=a[e];c!==void 0&&(this._deactivateAction(c),this._removeInactiveAction(c))}const s=this._bindingsByRootAndName,r=s[e];if(r!==void 0)for(const o in r){const a=r[o];a.restoreOriginalState(),this._removeInactiveBinding(a)}}uncacheAction(t,e){const n=this.existingAction(t,e);n!==null&&(this._deactivateAction(n),this._removeInactiveAction(n))}}const ym=new Gt;class X2{constructor(t,e,n=0,s=1/0){this.ray=new Ca(t,e),this.near=n,this.far=s,this.camera=null,this.layers=new bd,this.params={Mesh:{},Line:{threshold:1},LOD:{},Points:{threshold:1},Sprite:{}}}set(t,e){this.ray.set(t,e)}setFromCamera(t,e){e.isPerspectiveCamera?(this.ray.origin.setFromMatrixPosition(e.matrixWorld),this.ray.direction.set(t.x,t.y,.5).unproject(e).sub(this.ray.origin).normalize(),this.camera=e):e.isOrthographicCamera?(this.ray.origin.set(t.x,t.y,(e.near+e.far)/(e.near-e.far)).unproject(e),this.ray.direction.set(0,0,-1).transformDirection(e.matrixWorld),this.camera=e):console.error("THREE.Raycaster: Unsupported camera type: "+e.type)}setFromXRController(t){return ym.identity().extractRotation(t.matrixWorld),this.ray.origin.setFromMatrixPosition(t.matrixWorld),this.ray.direction.set(0,0,-1).applyMatrix4(ym),this}intersectObject(t,e=!0,n=[]){return Hh(t,this,n,e),n.sort(xm),n}intersectObjects(t,e=!0,n=[]){for(let s=0,r=t.length;s<r;s++)Hh(t[s],this,n,e);return n.sort(xm),n}}function xm(i,t){return i.distance-t.distance}function Hh(i,t,e,n){let s=!0;if(i.layers.test(t.layers)&&i.raycast(t,e)===!1&&(s=!1),s===!0&&n===!0){const r=i.children;for(let o=0,a=r.length;o<a;o++)Hh(r[o],t,e,!0)}}class q2{constructor(t=1,e=0,n=0){return this.radius=t,this.phi=e,this.theta=n,this}set(t,e,n){return this.radius=t,this.phi=e,this.theta=n,this}copy(t){return this.radius=t.radius,this.phi=t.phi,this.theta=t.theta,this}makeSafe(){return this.phi=Math.max(1e-6,Math.min(Math.PI-1e-6,this.phi)),this}setFromVector3(t){return this.setFromCartesianCoords(t.x,t.y,t.z)}setFromCartesianCoords(t,e,n){return this.radius=Math.sqrt(t*t+e*e+n*n),this.radius===0?(this.theta=0,this.phi=0):(this.theta=Math.atan2(t,n),this.phi=Math.acos($e(e/this.radius,-1,1))),this}clone(){return new this.constructor().copy(this)}}class j2 extends Ms{constructor(t,e=null){super(),this.object=t,this.domElement=e,this.enabled=!0,this.state=-1,this.keys={},this.mouseButtons={LEFT:null,MIDDLE:null,RIGHT:null},this.touches={ONE:null,TWO:null}}connect(){}disconnect(){}dispose(){}update(){}}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:pd}}));typeof window<"u"&&(window.__THREE__?console.warn("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=pd);const va=4;function Ws(){return{terrain:{cell:va,cells:{}},paint:{cell:va,cells:{}},objects:[],fences:[]}}const tb=/^-?\d+,-?\d+$/;function Em(i,t){const e={cell:va,cells:{}};if(!i||typeof i!="object")return e;const n=i;if(isFinite(Number(n.cell))&&Number(n.cell)>0&&(e.cell=Number(n.cell)),n.cells&&typeof n.cells=="object")for(const[s,r]of Object.entries(n.cells)){if(!tb.test(s))continue;const o=Number(r);isFinite(o)&&(t?o>=0&&o<=16777215&&(e.cells[s]=Math.round(o)):Math.abs(o)>=.01&&(e.cells[s]=Math.round(o*100)/100))}return e}function W_(i){const t=Ws();if(!i||typeof i!="object")return t;const e=i;if(t.terrain=Em(e.terrain,!1),t.paint=Em(e.paint,!0),Array.isArray(e.objects)){let n=0;for(const s of e.objects){if(!s||typeof s!="object")continue;const r=s,o=Number(r.x),a=Number(r.y),c=Number(r.z);if(!isFinite(o)||!isFinite(a)||!isFinite(c))continue;const l=(h,d)=>isFinite(Number(h))?Number(h):d;t.objects.push({id:typeof r.id=="string"&&r.id?r.id.slice(0,40):`obj_${++n}`,type:typeof r.type=="string"&&r.type?r.type.slice(0,24):"tree",tag:typeof r.tag=="string"?r.tag.slice(0,60):"",x:o,y:a,z:c,rotY:l(r.rotY,0),sx:Math.max(.2,l(r.sx,2)),sy:Math.max(.2,l(r.sy,2)),sz:Math.max(.2,l(r.sz,2))}),n=Math.max(n,Tm(t.objects[t.objects.length-1].id))}}if(Array.isArray(e.fences)){let n=0;for(const s of e.fences){if(!s||typeof s!="object")continue;const r=s;if(!Array.isArray(r.points)||r.points.length<2)continue;const o=[];for(const c of r.points){if(!c||typeof c!="object")continue;const l=Number(c.x),h=Number(c.z);isFinite(l)&&isFinite(h)&&o.push({x:l,z:h})}if(o.length<2)continue;const a={id:typeof r.id=="string"&&r.id?r.id.slice(0,40):`fence_${++n}`,points:o};isFinite(Number(r.height))&&Number(r.height)>0&&(a.height=Number(r.height)),isFinite(Number(r.postGap))&&Number(r.postGap)>.5&&(a.postGap=Number(r.postGap)),t.fences.push(a),n=Math.max(n,Tm(a.id))}}return t}function Tm(i){const t=/(\d+)$/.exec(i);return t?parseInt(t[1],10):0}function ol(i){return!i||!i.cells||Object.keys(i.cells).length===0}function eb(i){return ol(i.terrain)&&ol(i.paint)&&i.objects.length===0&&i.fences.length===0}function X_(i){const t={};return ol(i.terrain)||(t.terrain={cell:i.terrain.cell,cells:i.terrain.cells}),ol(i.paint)||(t.paint={cell:i.paint.cell,cells:i.paint.cells}),i.objects.length&&(t.objects=i.objects),i.fences.length&&(t.fences=i.fences),t}function nb(i,t,e){if(!i||!i.cells)return 0;const n=i.cell||va,s=i.cells,r=t/n,o=e/n,a=Math.floor(r),c=Math.floor(o),l=r-a,h=o-c,d=s[`${a},${c}`]||0,f=s[`${a+1},${c}`]||0,p=s[`${a},${c+1}`]||0,v=s[`${a+1},${c+1}`]||0,x=d+(f-d)*l,m=p+(v-p)*l;return x+(m-x)*h}function ib(i){return[(i>>16&255)/255,(i>>8&255)/255,(i&255)/255]}function sb(i,t,e,n){if(!i||!i.cells)return n;const s=i.cell||va,r=i.cells,o=t/s,a=e/s,c=Math.floor(o),l=Math.floor(a),h=o-c,d=a-l,f=(A,S)=>{const b=r[`${A},${S}`];return b==null?n:ib(b)},p=f(c,l),v=f(c+1,l),x=f(c,l+1),m=f(c+1,l+1),_=[0,0,0];for(let A=0;A<3;A++){const S=p[A]+(v[A]-p[A])*h,b=x[A]+(m[A]-x[A])*h;_[A]=S+(b-S)*d}return _}const no=60,ts=no-1.5,De={cx:-6,cz:6,half:12,y:.15},Ke={cx:30,cz:-26,r:10,waterY:-1.15},Nu=[[24,20],[16,14],[De.cx+De.half+1.5,De.cz],[De.cx,De.cz],[16,-6],[Ke.cx-2,Ke.cz+Ke.r+1]],Sm=2,rb=1.8,Uu=1.9;let zs=null,q_=!1,j_=!1;const Am=1.5;function K2(i){zs=i,ob()}function ob(){q_=!!(zs&&Object.keys(zs.terrain.cells).length),j_=!!(zs&&Object.keys(zs.paint.cells).length)}function K_(i,t){return Math.abs(i-De.cx)<=De.half+Am&&Math.abs(t-De.cz)<=De.half+Am}function ab(i,t){return Uu*Math.sin(i*.045+.5)*Math.cos(t*.05)+Uu*.5*Math.sin(i*.09-t*.06)+Uu*.35*Math.cos(t*.13+1.3)}function Gh(i,t,e){const n=Math.min(1,Math.max(0,(e-i)/(t-i)));return n*n*(3-2*n)}function cb(i,t,e,n,s,r){const o=s-e,a=r-n,c=o*o+a*a;let l=c>0?((i-e)*o+(t-n)*a)/c:0;return l=Math.min(1,Math.max(0,l)),Math.hypot(i-(e+o*l),t-(n+a*l))}function lb(i,t){if(K_(i,t))return 0;let e=1/0;for(let n=0;n<Nu.length-1;n++){const s=Nu[n],r=Nu[n+1],o=cb(i,t,s[0],s[1],r[0],r[1]);if(o<e&&(e=o),e<=0)break}return 1-Gh(Sm,Sm+rb,e)}function _s(i,t){let e=ab(i,t);q_&&!K_(i,t)&&(e+=nb(zs.terrain,i,t));const n=Math.abs(i-De.cx),s=Math.abs(t-De.cz),r=Math.max(n,s),o=1-Gh(De.half,De.half+6,r);e=e*(1-o)+De.y*o;const a=Math.hypot(i-Ke.cx,t-Ke.cz);if(a<Ke.r+8){const c=1-Gh(Ke.r-2,Ke.r+8,a),l=Ke.waterY-.6;e=e*(1-c)+l*c}return e}const ub=new It("#7ba659"),hb=new It("#5f8a45"),db=new It("#a9825a"),fb=new It("#8a6642"),pb=new It("#9c7a52");let Ou=null;function mb(){if(Ou)return Ou;const i=256,t=document.createElement("canvas");t.width=t.height=i;const e=t.getContext("2d");e.fillStyle="#8a8a8a",e.fillRect(0,0,i,i);let n=1337;const s=()=>(n=n*1664525+1013904223&4294967295,(n>>>0)/4294967295);for(let o=0;o<5200;o++){const a=s()*i,c=s()*i,l=2+s()*5,h=120+Math.floor(s()*110);e.strokeStyle=`rgb(${h},${h},${h})`,e.lineWidth=.8,e.beginPath(),e.moveTo(a,c),e.lineTo(a+(s()-.5)*2,c-l),e.stroke()}const r=new WM(t);return r.wrapS=r.wrapT=Ks,r.colorSpace=hn,Ou=r,r}function $2(){const t=no*2,e=new us(t,t,120,120);e.rotateX(-Math.PI/2);const n=e.attributes.position,s=new Float32Array(n.count*3),r=new It,o=new It;for(let h=0;h<n.count;h++){const d=n.getX(h),f=n.getZ(h);n.setY(h,_s(d,f));const p=.5+.5*(.5+.5*Math.sin(d*.06+1.1))*(.5+.5*Math.cos(f*.07-.4)),v=Math.abs(d-De.cx)<=De.half+1&&Math.abs(f-De.cz)<=De.half+1;if(v?r.copy(fb).lerp(db,p):r.copy(hb).lerp(ub,p),o.setRGB((Math.sin(h*12.9)*.5+.5)*.06,0,0),r.r=Math.min(1,r.r+o.r*.1),!v){const x=lb(d,f);x>0&&r.lerp(pb,x)}if(j_){const[x,m,_]=sb(zs.paint,d,f,[r.r,r.g,r.b]);r.setRGB(x,m,_)}s[h*3]=r.r,s[h*3+1]=r.g,s[h*3+2]=r.b}e.setAttribute("color",new An(s,3)),e.computeVertexNormals();const a=e.attributes.uv;for(let h=0;h<n.count;h++)a.setXY(h,n.getX(h)/5,n.getZ(h)/5);const c=new gs({vertexColors:!0,map:mb()}),l=new ve(e,c);return l.receiveShadow=!0,l.name="ground",l}const Cr=.55,Bi=[];let kd=1;function Y2(){return Bi.length}function J2(i){for(let t=Bi.length-1;t>=0;t--)Bi[t].tag===i&&Bi.splice(t,1)}function zd(i,t,e,n){const s=kd++;return Bi.push({kind:"circle",x:i,z:t,r:e,hid:s,tag:n}),s}function gb(i,t,e,n,s){const r=kd++;return Bi.push({kind:"box",minX:i-e,maxX:i+e,minZ:t-n,maxZ:t+n,hid:r,tag:s}),r}function _b(i,t,e,n,s=.25,r){const o=kd++;return Bi.push({kind:"seg",x1:i,z1:t,x2:e,z2:n,r:s,hid:o,tag:r}),o}function Z2(i,t,e){for(const n of Bi)if(n.kind==="circle"){if(Math.hypot(i-n.x,t-n.z)<n.r+e)return!0}else if(n.kind==="box"){const s=Math.max(n.minX,Math.min(n.maxX,i)),r=Math.max(n.minZ,Math.min(n.maxZ,t));if(Math.hypot(i-s,t-r)<e)return!0}else if($_(i,t,n.x1,n.z1,n.x2,n.z2).d<n.r+e)return!0;return!1}function $_(i,t,e,n,s,r){const o=s-e,a=r-n,c=o*o+a*a||1e-6;let l=((i-e)*o+(t-n)*a)/c;l=Math.max(0,Math.min(1,l));const h=e+o*l,d=n+a*l;return{x:h,z:d,d:Math.hypot(i-h,t-d)}}function Q2(i,t){let e=i,n=t;e=Math.max(-ts,Math.min(ts,e)),n=Math.max(-ts,Math.min(ts,n));for(let s=0;s<2;s++)for(const r of Bi)if(r.kind==="circle"){const o=Math.hypot(e-r.x,n-r.z),a=r.r+Cr;if(o<a){const c=o>1e-4?(e-r.x)/o:1,l=o>1e-4?(n-r.z)/o:0;e=r.x+c*a,n=r.z+l*a}}else if(r.kind==="box"){const o=r.minX-Cr,a=r.maxX+Cr,c=r.minZ-Cr,l=r.maxZ+Cr;if(e>o&&e<a&&n>c&&n<l){const h=e-o,d=a-e,f=n-c,p=l-n,v=Math.min(h,d,f,p);v===h?e=o:v===d?e=a:v===f?n=c:n=l}}else{const o=$_(e,n,r.x1,r.z1,r.x2,r.z2),a=r.r+Cr;if(o.d<a){const c=o.d>1e-4?(e-o.x)/o.d:1,l=o.d>1e-4?(n-o.z)/o.d:0;e=o.x+c*a,n=o.z+l*a}}return e=Math.max(-ts,Math.min(ts,e)),n=Math.max(-ts,Math.min(ts,n)),{x:e,z:n}}function Mm(i,t){if(t===$y)return console.warn("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Geometry already defined as triangles."),i;if(t===Nh||t===a_){let e=i.getIndex();if(e===null){const o=[],a=i.getAttribute("position");if(a!==void 0){for(let c=0;c<a.count;c++)o.push(c);i.setIndex(o),e=i.getIndex()}else return console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Undefined position attribute. Processing not possible."),i}const n=e.count-2,s=[];if(t===Nh)for(let o=1;o<=n;o++)s.push(e.getX(0)),s.push(e.getX(o)),s.push(e.getX(o+1));else for(let o=0;o<n;o++)o%2===0?(s.push(e.getX(o)),s.push(e.getX(o+1)),s.push(e.getX(o+2))):(s.push(e.getX(o+2)),s.push(e.getX(o+1)),s.push(e.getX(o)));s.length/3!==n&&console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unable to generate correct amount of triangles.");const r=i.clone();return r.setIndex(s),r.clearGroups(),r}else return console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unknown draw mode:",t),i}class vb extends fo{constructor(t){super(t),this.dracoLoader=null,this.ktx2Loader=null,this.meshoptDecoder=null,this.pluginCallbacks=[],this.register(function(e){return new Sb(e)}),this.register(function(e){return new Ab(e)}),this.register(function(e){return new Lb(e)}),this.register(function(e){return new Nb(e)}),this.register(function(e){return new Ub(e)}),this.register(function(e){return new wb(e)}),this.register(function(e){return new bb(e)}),this.register(function(e){return new Rb(e)}),this.register(function(e){return new Ib(e)}),this.register(function(e){return new Tb(e)}),this.register(function(e){return new Cb(e)}),this.register(function(e){return new Mb(e)}),this.register(function(e){return new Db(e)}),this.register(function(e){return new Pb(e)}),this.register(function(e){return new xb(e)}),this.register(function(e){return new Ob(e)}),this.register(function(e){return new Fb(e)})}load(t,e,n,s){const r=this;let o;if(this.resourcePath!=="")o=this.resourcePath;else if(this.path!==""){const l=ia.extractUrlBase(t);o=ia.resolveURL(l,this.path)}else o=ia.extractUrlBase(t);this.manager.itemStart(t);const a=function(l){s?s(l):console.error(l),r.manager.itemError(t),r.manager.itemEnd(t)},c=new G_(this.manager);c.setPath(this.path),c.setResponseType("arraybuffer"),c.setRequestHeader(this.requestHeader),c.setWithCredentials(this.withCredentials),c.load(t,function(l){try{r.parse(l,o,function(h){e(h),r.manager.itemEnd(t)},a)}catch(h){a(h)}},n,a)}setDRACOLoader(t){return this.dracoLoader=t,this}setKTX2Loader(t){return this.ktx2Loader=t,this}setMeshoptDecoder(t){return this.meshoptDecoder=t,this}register(t){return this.pluginCallbacks.indexOf(t)===-1&&this.pluginCallbacks.push(t),this}unregister(t){return this.pluginCallbacks.indexOf(t)!==-1&&this.pluginCallbacks.splice(this.pluginCallbacks.indexOf(t),1),this}parse(t,e,n,s){let r;const o={},a={},c=new TextDecoder;if(typeof t=="string")r=JSON.parse(t);else if(t instanceof ArrayBuffer)if(c.decode(new Uint8Array(t,0,4))===Y_){try{o[ie.KHR_BINARY_GLTF]=new Vb(t)}catch(d){s&&s(d);return}r=JSON.parse(o[ie.KHR_BINARY_GLTF].content)}else r=JSON.parse(c.decode(t));else r=t;if(r.asset===void 0||r.asset.version[0]<2){s&&s(new Error("THREE.GLTFLoader: Unsupported asset. glTF versions >=2.0 are supported."));return}const l=new Jb(r,{path:e||this.resourcePath||"",crossOrigin:this.crossOrigin,requestHeader:this.requestHeader,manager:this.manager,ktx2Loader:this.ktx2Loader,meshoptDecoder:this.meshoptDecoder});l.fileLoader.setRequestHeader(this.requestHeader);for(let h=0;h<this.pluginCallbacks.length;h++){const d=this.pluginCallbacks[h](l);d.name||console.error("THREE.GLTFLoader: Invalid plugin found: missing name"),a[d.name]=d,o[d.name]=!0}if(r.extensionsUsed)for(let h=0;h<r.extensionsUsed.length;++h){const d=r.extensionsUsed[h],f=r.extensionsRequired||[];switch(d){case ie.KHR_MATERIALS_UNLIT:o[d]=new Eb;break;case ie.KHR_DRACO_MESH_COMPRESSION:o[d]=new Bb(r,this.dracoLoader);break;case ie.KHR_TEXTURE_TRANSFORM:o[d]=new kb;break;case ie.KHR_MESH_QUANTIZATION:o[d]=new zb;break;default:f.indexOf(d)>=0&&a[d]===void 0&&console.warn('THREE.GLTFLoader: Unknown extension "'+d+'".')}}l.setExtensions(o),l.setPlugins(a),l.parse(n,s)}parseAsync(t,e){const n=this;return new Promise(function(s,r){n.parse(t,e,s,r)})}}function yb(){let i={};return{get:function(t){return i[t]},add:function(t,e){i[t]=e},remove:function(t){delete i[t]},removeAll:function(){i={}}}}const ie={KHR_BINARY_GLTF:"KHR_binary_glTF",KHR_DRACO_MESH_COMPRESSION:"KHR_draco_mesh_compression",KHR_LIGHTS_PUNCTUAL:"KHR_lights_punctual",KHR_MATERIALS_CLEARCOAT:"KHR_materials_clearcoat",KHR_MATERIALS_DISPERSION:"KHR_materials_dispersion",KHR_MATERIALS_IOR:"KHR_materials_ior",KHR_MATERIALS_SHEEN:"KHR_materials_sheen",KHR_MATERIALS_SPECULAR:"KHR_materials_specular",KHR_MATERIALS_TRANSMISSION:"KHR_materials_transmission",KHR_MATERIALS_IRIDESCENCE:"KHR_materials_iridescence",KHR_MATERIALS_ANISOTROPY:"KHR_materials_anisotropy",KHR_MATERIALS_UNLIT:"KHR_materials_unlit",KHR_MATERIALS_VOLUME:"KHR_materials_volume",KHR_TEXTURE_BASISU:"KHR_texture_basisu",KHR_TEXTURE_TRANSFORM:"KHR_texture_transform",KHR_MESH_QUANTIZATION:"KHR_mesh_quantization",KHR_MATERIALS_EMISSIVE_STRENGTH:"KHR_materials_emissive_strength",EXT_MATERIALS_BUMP:"EXT_materials_bump",EXT_TEXTURE_WEBP:"EXT_texture_webp",EXT_TEXTURE_AVIF:"EXT_texture_avif",EXT_MESHOPT_COMPRESSION:"EXT_meshopt_compression",EXT_MESH_GPU_INSTANCING:"EXT_mesh_gpu_instancing"};class xb{constructor(t){this.parser=t,this.name=ie.KHR_LIGHTS_PUNCTUAL,this.cache={refs:{},uses:{}}}_markDefs(){const t=this.parser,e=this.parser.json.nodes||[];for(let n=0,s=e.length;n<s;n++){const r=e[n];r.extensions&&r.extensions[this.name]&&r.extensions[this.name].light!==void 0&&t._addNodeRef(this.cache,r.extensions[this.name].light)}}_loadLight(t){const e=this.parser,n="light:"+t;let s=e.cache.get(n);if(s)return s;const r=e.json,c=((r.extensions&&r.extensions[this.name]||{}).lights||[])[t];let l;const h=new It(16777215);c.color!==void 0&&h.setRGB(c.color[0],c.color[1],c.color[2],fn);const d=c.range!==void 0?c.range:0;switch(c.type){case"directional":l=new Bw(h),l.target.position.set(0,0,-1),l.add(l.target);break;case"point":l=new Fw(h),l.distance=d;break;case"spot":l=new Uw(h),l.distance=d,c.spot=c.spot||{},c.spot.innerConeAngle=c.spot.innerConeAngle!==void 0?c.spot.innerConeAngle:0,c.spot.outerConeAngle=c.spot.outerConeAngle!==void 0?c.spot.outerConeAngle:Math.PI/4,l.angle=c.spot.outerConeAngle,l.penumbra=1-c.spot.innerConeAngle/c.spot.outerConeAngle,l.target.position.set(0,0,-1),l.add(l.target);break;default:throw new Error("THREE.GLTFLoader: Unexpected light type: "+c.type)}return l.position.set(0,0,0),l.decay=2,Oi(l,c),c.intensity!==void 0&&(l.intensity=c.intensity),l.name=e.createUniqueName(c.name||"light_"+t),s=Promise.resolve(l),e.cache.add(n,s),s}getDependency(t,e){if(t==="light")return this._loadLight(e)}createNodeAttachment(t){const e=this,n=this.parser,r=n.json.nodes[t],a=(r.extensions&&r.extensions[this.name]||{}).light;return a===void 0?null:this._loadLight(a).then(function(c){return n._getNodeRef(e.cache,a,c)})}}class Eb{constructor(){this.name=ie.KHR_MATERIALS_UNLIT}getMaterialType(){return ks}extendParams(t,e,n){const s=[];t.color=new It(1,1,1),t.opacity=1;const r=e.pbrMetallicRoughness;if(r){if(Array.isArray(r.baseColorFactor)){const o=r.baseColorFactor;t.color.setRGB(o[0],o[1],o[2],fn),t.opacity=o[3]}r.baseColorTexture!==void 0&&s.push(n.assignTexture(t,"map",r.baseColorTexture,hn))}return Promise.all(s)}}class Tb{constructor(t){this.parser=t,this.name=ie.KHR_MATERIALS_EMISSIVE_STRENGTH}extendMaterialParams(t,e){const s=this.parser.json.materials[t];if(!s.extensions||!s.extensions[this.name])return Promise.resolve();const r=s.extensions[this.name].emissiveStrength;return r!==void 0&&(e.emissiveIntensity=r),Promise.resolve()}}class Sb{constructor(t){this.parser=t,this.name=ie.KHR_MATERIALS_CLEARCOAT}getMaterialType(t){const n=this.parser.json.materials[t];return!n.extensions||!n.extensions[this.name]?null:Mi}extendMaterialParams(t,e){const n=this.parser,s=n.json.materials[t];if(!s.extensions||!s.extensions[this.name])return Promise.resolve();const r=[],o=s.extensions[this.name];if(o.clearcoatFactor!==void 0&&(e.clearcoat=o.clearcoatFactor),o.clearcoatTexture!==void 0&&r.push(n.assignTexture(e,"clearcoatMap",o.clearcoatTexture)),o.clearcoatRoughnessFactor!==void 0&&(e.clearcoatRoughness=o.clearcoatRoughnessFactor),o.clearcoatRoughnessTexture!==void 0&&r.push(n.assignTexture(e,"clearcoatRoughnessMap",o.clearcoatRoughnessTexture)),o.clearcoatNormalTexture!==void 0&&(r.push(n.assignTexture(e,"clearcoatNormalMap",o.clearcoatNormalTexture)),o.clearcoatNormalTexture.scale!==void 0)){const a=o.clearcoatNormalTexture.scale;e.clearcoatNormalScale=new dt(a,a)}return Promise.all(r)}}class Ab{constructor(t){this.parser=t,this.name=ie.KHR_MATERIALS_DISPERSION}getMaterialType(t){const n=this.parser.json.materials[t];return!n.extensions||!n.extensions[this.name]?null:Mi}extendMaterialParams(t,e){const s=this.parser.json.materials[t];if(!s.extensions||!s.extensions[this.name])return Promise.resolve();const r=s.extensions[this.name];return e.dispersion=r.dispersion!==void 0?r.dispersion:0,Promise.resolve()}}class Mb{constructor(t){this.parser=t,this.name=ie.KHR_MATERIALS_IRIDESCENCE}getMaterialType(t){const n=this.parser.json.materials[t];return!n.extensions||!n.extensions[this.name]?null:Mi}extendMaterialParams(t,e){const n=this.parser,s=n.json.materials[t];if(!s.extensions||!s.extensions[this.name])return Promise.resolve();const r=[],o=s.extensions[this.name];return o.iridescenceFactor!==void 0&&(e.iridescence=o.iridescenceFactor),o.iridescenceTexture!==void 0&&r.push(n.assignTexture(e,"iridescenceMap",o.iridescenceTexture)),o.iridescenceIor!==void 0&&(e.iridescenceIOR=o.iridescenceIor),e.iridescenceThicknessRange===void 0&&(e.iridescenceThicknessRange=[100,400]),o.iridescenceThicknessMinimum!==void 0&&(e.iridescenceThicknessRange[0]=o.iridescenceThicknessMinimum),o.iridescenceThicknessMaximum!==void 0&&(e.iridescenceThicknessRange[1]=o.iridescenceThicknessMaximum),o.iridescenceThicknessTexture!==void 0&&r.push(n.assignTexture(e,"iridescenceThicknessMap",o.iridescenceThicknessTexture)),Promise.all(r)}}class wb{constructor(t){this.parser=t,this.name=ie.KHR_MATERIALS_SHEEN}getMaterialType(t){const n=this.parser.json.materials[t];return!n.extensions||!n.extensions[this.name]?null:Mi}extendMaterialParams(t,e){const n=this.parser,s=n.json.materials[t];if(!s.extensions||!s.extensions[this.name])return Promise.resolve();const r=[];e.sheenColor=new It(0,0,0),e.sheenRoughness=0,e.sheen=1;const o=s.extensions[this.name];if(o.sheenColorFactor!==void 0){const a=o.sheenColorFactor;e.sheenColor.setRGB(a[0],a[1],a[2],fn)}return o.sheenRoughnessFactor!==void 0&&(e.sheenRoughness=o.sheenRoughnessFactor),o.sheenColorTexture!==void 0&&r.push(n.assignTexture(e,"sheenColorMap",o.sheenColorTexture,hn)),o.sheenRoughnessTexture!==void 0&&r.push(n.assignTexture(e,"sheenRoughnessMap",o.sheenRoughnessTexture)),Promise.all(r)}}class bb{constructor(t){this.parser=t,this.name=ie.KHR_MATERIALS_TRANSMISSION}getMaterialType(t){const n=this.parser.json.materials[t];return!n.extensions||!n.extensions[this.name]?null:Mi}extendMaterialParams(t,e){const n=this.parser,s=n.json.materials[t];if(!s.extensions||!s.extensions[this.name])return Promise.resolve();const r=[],o=s.extensions[this.name];return o.transmissionFactor!==void 0&&(e.transmission=o.transmissionFactor),o.transmissionTexture!==void 0&&r.push(n.assignTexture(e,"transmissionMap",o.transmissionTexture)),Promise.all(r)}}class Rb{constructor(t){this.parser=t,this.name=ie.KHR_MATERIALS_VOLUME}getMaterialType(t){const n=this.parser.json.materials[t];return!n.extensions||!n.extensions[this.name]?null:Mi}extendMaterialParams(t,e){const n=this.parser,s=n.json.materials[t];if(!s.extensions||!s.extensions[this.name])return Promise.resolve();const r=[],o=s.extensions[this.name];e.thickness=o.thicknessFactor!==void 0?o.thicknessFactor:0,o.thicknessTexture!==void 0&&r.push(n.assignTexture(e,"thicknessMap",o.thicknessTexture)),e.attenuationDistance=o.attenuationDistance||1/0;const a=o.attenuationColor||[1,1,1];return e.attenuationColor=new It().setRGB(a[0],a[1],a[2],fn),Promise.all(r)}}class Ib{constructor(t){this.parser=t,this.name=ie.KHR_MATERIALS_IOR}getMaterialType(t){const n=this.parser.json.materials[t];return!n.extensions||!n.extensions[this.name]?null:Mi}extendMaterialParams(t,e){const s=this.parser.json.materials[t];if(!s.extensions||!s.extensions[this.name])return Promise.resolve();const r=s.extensions[this.name];return e.ior=r.ior!==void 0?r.ior:1.5,Promise.resolve()}}class Cb{constructor(t){this.parser=t,this.name=ie.KHR_MATERIALS_SPECULAR}getMaterialType(t){const n=this.parser.json.materials[t];return!n.extensions||!n.extensions[this.name]?null:Mi}extendMaterialParams(t,e){const n=this.parser,s=n.json.materials[t];if(!s.extensions||!s.extensions[this.name])return Promise.resolve();const r=[],o=s.extensions[this.name];e.specularIntensity=o.specularFactor!==void 0?o.specularFactor:1,o.specularTexture!==void 0&&r.push(n.assignTexture(e,"specularIntensityMap",o.specularTexture));const a=o.specularColorFactor||[1,1,1];return e.specularColor=new It().setRGB(a[0],a[1],a[2],fn),o.specularColorTexture!==void 0&&r.push(n.assignTexture(e,"specularColorMap",o.specularColorTexture,hn)),Promise.all(r)}}class Pb{constructor(t){this.parser=t,this.name=ie.EXT_MATERIALS_BUMP}getMaterialType(t){const n=this.parser.json.materials[t];return!n.extensions||!n.extensions[this.name]?null:Mi}extendMaterialParams(t,e){const n=this.parser,s=n.json.materials[t];if(!s.extensions||!s.extensions[this.name])return Promise.resolve();const r=[],o=s.extensions[this.name];return e.bumpScale=o.bumpFactor!==void 0?o.bumpFactor:1,o.bumpTexture!==void 0&&r.push(n.assignTexture(e,"bumpMap",o.bumpTexture)),Promise.all(r)}}class Db{constructor(t){this.parser=t,this.name=ie.KHR_MATERIALS_ANISOTROPY}getMaterialType(t){const n=this.parser.json.materials[t];return!n.extensions||!n.extensions[this.name]?null:Mi}extendMaterialParams(t,e){const n=this.parser,s=n.json.materials[t];if(!s.extensions||!s.extensions[this.name])return Promise.resolve();const r=[],o=s.extensions[this.name];return o.anisotropyStrength!==void 0&&(e.anisotropy=o.anisotropyStrength),o.anisotropyRotation!==void 0&&(e.anisotropyRotation=o.anisotropyRotation),o.anisotropyTexture!==void 0&&r.push(n.assignTexture(e,"anisotropyMap",o.anisotropyTexture)),Promise.all(r)}}class Lb{constructor(t){this.parser=t,this.name=ie.KHR_TEXTURE_BASISU}loadTexture(t){const e=this.parser,n=e.json,s=n.textures[t];if(!s.extensions||!s.extensions[this.name])return null;const r=s.extensions[this.name],o=e.options.ktx2Loader;if(!o){if(n.extensionsRequired&&n.extensionsRequired.indexOf(this.name)>=0)throw new Error("THREE.GLTFLoader: setKTX2Loader must be called before loading KTX2 textures");return null}return e.loadTextureImage(t,r.source,o)}}class Nb{constructor(t){this.parser=t,this.name=ie.EXT_TEXTURE_WEBP,this.isSupported=null}loadTexture(t){const e=this.name,n=this.parser,s=n.json,r=s.textures[t];if(!r.extensions||!r.extensions[e])return null;const o=r.extensions[e],a=s.images[o.source];let c=n.textureLoader;if(a.uri){const l=n.options.manager.getHandler(a.uri);l!==null&&(c=l)}return this.detectSupport().then(function(l){if(l)return n.loadTextureImage(t,o.source,c);if(s.extensionsRequired&&s.extensionsRequired.indexOf(e)>=0)throw new Error("THREE.GLTFLoader: WebP required by asset but unsupported.");return n.loadTexture(t)})}detectSupport(){return this.isSupported||(this.isSupported=new Promise(function(t){const e=new Image;e.src="data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA",e.onload=e.onerror=function(){t(e.height===1)}})),this.isSupported}}class Ub{constructor(t){this.parser=t,this.name=ie.EXT_TEXTURE_AVIF,this.isSupported=null}loadTexture(t){const e=this.name,n=this.parser,s=n.json,r=s.textures[t];if(!r.extensions||!r.extensions[e])return null;const o=r.extensions[e],a=s.images[o.source];let c=n.textureLoader;if(a.uri){const l=n.options.manager.getHandler(a.uri);l!==null&&(c=l)}return this.detectSupport().then(function(l){if(l)return n.loadTextureImage(t,o.source,c);if(s.extensionsRequired&&s.extensionsRequired.indexOf(e)>=0)throw new Error("THREE.GLTFLoader: AVIF required by asset but unsupported.");return n.loadTexture(t)})}detectSupport(){return this.isSupported||(this.isSupported=new Promise(function(t){const e=new Image;e.src="data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAABcAAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAEAAAABAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQAMAAAAABNjb2xybmNseAACAAIABoAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAAB9tZGF0EgAKCBgABogQEDQgMgkQAAAAB8dSLfI=",e.onload=e.onerror=function(){t(e.height===1)}})),this.isSupported}}class Ob{constructor(t){this.name=ie.EXT_MESHOPT_COMPRESSION,this.parser=t}loadBufferView(t){const e=this.parser.json,n=e.bufferViews[t];if(n.extensions&&n.extensions[this.name]){const s=n.extensions[this.name],r=this.parser.getDependency("buffer",s.buffer),o=this.parser.options.meshoptDecoder;if(!o||!o.supported){if(e.extensionsRequired&&e.extensionsRequired.indexOf(this.name)>=0)throw new Error("THREE.GLTFLoader: setMeshoptDecoder must be called before loading compressed files");return null}return r.then(function(a){const c=s.byteOffset||0,l=s.byteLength||0,h=s.count,d=s.byteStride,f=new Uint8Array(a,c,l);return o.decodeGltfBufferAsync?o.decodeGltfBufferAsync(h,d,f,s.mode,s.filter).then(function(p){return p.buffer}):o.ready.then(function(){const p=new ArrayBuffer(h*d);return o.decodeGltfBuffer(new Uint8Array(p),h,d,f,s.mode,s.filter),p})})}else return null}}class Fb{constructor(t){this.name=ie.EXT_MESH_GPU_INSTANCING,this.parser=t}createNodeMesh(t){const e=this.parser.json,n=e.nodes[t];if(!n.extensions||!n.extensions[this.name]||n.mesh===void 0)return null;const s=e.meshes[n.mesh];for(const l of s.primitives)if(l.mode!==zn.TRIANGLES&&l.mode!==zn.TRIANGLE_STRIP&&l.mode!==zn.TRIANGLE_FAN&&l.mode!==void 0)return null;const o=n.extensions[this.name].attributes,a=[],c={};for(const l in o)a.push(this.parser.getDependency("accessor",o[l]).then(h=>(c[l]=h,c[l])));return a.length<1?null:(a.push(this.parser.createNodeMesh(t)),Promise.all(a).then(l=>{const h=l.pop(),d=h.isGroup?h.children:[h],f=l[0].count,p=[];for(const v of d){const x=new Gt,m=new O,_=new oi,A=new O(1,1,1),S=new Qo(v.geometry,v.material,f);for(let b=0;b<f;b++)c.TRANSLATION&&m.fromBufferAttribute(c.TRANSLATION,b),c.ROTATION&&_.fromBufferAttribute(c.ROTATION,b),c.SCALE&&A.fromBufferAttribute(c.SCALE,b),S.setMatrixAt(b,x.compose(m,_,A));for(const b in c)if(b==="_COLOR_0"){const F=c[b];S.instanceColor=new Fh(F.array,F.itemSize,F.normalized)}else b!=="TRANSLATION"&&b!=="ROTATION"&&b!=="SCALE"&&v.geometry.setAttribute(b,c[b]);Me.prototype.copy.call(S,v),this.parser.assignFinalMaterial(S),p.push(S)}return h.isGroup?(h.clear(),h.add(...p),h):p[0]}))}}const Y_="glTF",Ho=12,wm={JSON:1313821514,BIN:5130562};class Vb{constructor(t){this.name=ie.KHR_BINARY_GLTF,this.content=null,this.body=null;const e=new DataView(t,0,Ho),n=new TextDecoder;if(this.header={magic:n.decode(new Uint8Array(t.slice(0,4))),version:e.getUint32(4,!0),length:e.getUint32(8,!0)},this.header.magic!==Y_)throw new Error("THREE.GLTFLoader: Unsupported glTF-Binary header.");if(this.header.version<2)throw new Error("THREE.GLTFLoader: Legacy binary file detected.");const s=this.header.length-Ho,r=new DataView(t,Ho);let o=0;for(;o<s;){const a=r.getUint32(o,!0);o+=4;const c=r.getUint32(o,!0);if(o+=4,c===wm.JSON){const l=new Uint8Array(t,Ho+o,a);this.content=n.decode(l)}else if(c===wm.BIN){const l=Ho+o;this.body=t.slice(l,l+a)}o+=a}if(this.content===null)throw new Error("THREE.GLTFLoader: JSON content not found.")}}class Bb{constructor(t,e){if(!e)throw new Error("THREE.GLTFLoader: No DRACOLoader instance provided.");this.name=ie.KHR_DRACO_MESH_COMPRESSION,this.json=t,this.dracoLoader=e,this.dracoLoader.preload()}decodePrimitive(t,e){const n=this.json,s=this.dracoLoader,r=t.extensions[this.name].bufferView,o=t.extensions[this.name].attributes,a={},c={},l={};for(const h in o){const d=Wh[h]||h.toLowerCase();a[d]=o[h]}for(const h in t.attributes){const d=Wh[h]||h.toLowerCase();if(o[h]!==void 0){const f=n.accessors[t.attributes[h]],p=Hr[f.componentType];l[d]=p.name,c[d]=f.normalized===!0}}return e.getDependency("bufferView",r).then(function(h){return new Promise(function(d,f){s.decodeDracoFile(h,function(p){for(const v in p.attributes){const x=p.attributes[v],m=c[v];m!==void 0&&(x.normalized=m)}d(p)},a,l,fn,f)})})}}class kb{constructor(){this.name=ie.KHR_TEXTURE_TRANSFORM}extendTexture(t,e){return(e.texCoord===void 0||e.texCoord===t.channel)&&e.offset===void 0&&e.rotation===void 0&&e.scale===void 0||(t=t.clone(),e.texCoord!==void 0&&(t.channel=e.texCoord),e.offset!==void 0&&t.offset.fromArray(e.offset),e.rotation!==void 0&&(t.rotation=e.rotation),e.scale!==void 0&&t.repeat.fromArray(e.scale),t.needsUpdate=!0),t}}class zb{constructor(){this.name=ie.KHR_MESH_QUANTIZATION}}class J_ extends Pa{constructor(t,e,n,s){super(t,e,n,s)}copySampleValue_(t){const e=this.resultBuffer,n=this.sampleValues,s=this.valueSize,r=t*s*3+s;for(let o=0;o!==s;o++)e[o]=n[r+o];return e}interpolate_(t,e,n,s){const r=this.resultBuffer,o=this.sampleValues,a=this.valueSize,c=a*2,l=a*3,h=s-e,d=(n-e)/h,f=d*d,p=f*d,v=t*l,x=v-l,m=-2*p+3*f,_=p-f,A=1-m,S=_-f+d;for(let b=0;b!==a;b++){const F=o[x+b+a],N=o[x+b+c]*h,M=o[v+b+a],w=o[v+b]*h;r[b]=A*F+S*N+m*M+_*w}return r}}const Hb=new oi;class Gb extends J_{interpolate_(t,e,n,s){const r=super.interpolate_(t,e,n,s);return Hb.fromArray(r).normalize().toArray(r),r}}const zn={POINTS:0,LINES:1,LINE_LOOP:2,LINE_STRIP:3,TRIANGLES:4,TRIANGLE_STRIP:5,TRIANGLE_FAN:6},Hr={5120:Int8Array,5121:Uint8Array,5122:Int16Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array},bm={9728:Rn,9729:Fn,9984:Jg,9985:Nc,9986:Wo,9987:Fi},Rm={33071:ss,33648:Yc,10497:Ks},Fu={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16},Wh={POSITION:"position",NORMAL:"normal",TANGENT:"tangent",TEXCOORD_0:"uv",TEXCOORD_1:"uv1",TEXCOORD_2:"uv2",TEXCOORD_3:"uv3",COLOR_0:"color",WEIGHTS_0:"skinWeight",JOINTS_0:"skinIndex"},es={scale:"scale",translation:"position",rotation:"quaternion",weights:"morphTargetInfluences"},Wb={CUBICSPLINE:void 0,LINEAR:ha,STEP:ua},Vu={OPAQUE:"OPAQUE",MASK:"MASK",BLEND:"BLEND"};function Xb(i){return i.DefaultMaterial===void 0&&(i.DefaultMaterial=new Od({color:16777215,emissive:0,metalness:1,roughness:1,transparent:!1,depthTest:!0,side:yi})),i.DefaultMaterial}function Ns(i,t,e){for(const n in e.extensions)i[n]===void 0&&(t.userData.gltfExtensions=t.userData.gltfExtensions||{},t.userData.gltfExtensions[n]=e.extensions[n])}function Oi(i,t){t.extras!==void 0&&(typeof t.extras=="object"?Object.assign(i.userData,t.extras):console.warn("THREE.GLTFLoader: Ignoring primitive type .extras, "+t.extras))}function qb(i,t,e){let n=!1,s=!1,r=!1;for(let l=0,h=t.length;l<h;l++){const d=t[l];if(d.POSITION!==void 0&&(n=!0),d.NORMAL!==void 0&&(s=!0),d.COLOR_0!==void 0&&(r=!0),n&&s&&r)break}if(!n&&!s&&!r)return Promise.resolve(i);const o=[],a=[],c=[];for(let l=0,h=t.length;l<h;l++){const d=t[l];if(n){const f=d.POSITION!==void 0?e.getDependency("accessor",d.POSITION):i.attributes.position;o.push(f)}if(s){const f=d.NORMAL!==void 0?e.getDependency("accessor",d.NORMAL):i.attributes.normal;a.push(f)}if(r){const f=d.COLOR_0!==void 0?e.getDependency("accessor",d.COLOR_0):i.attributes.color;c.push(f)}}return Promise.all([Promise.all(o),Promise.all(a),Promise.all(c)]).then(function(l){const h=l[0],d=l[1],f=l[2];return n&&(i.morphAttributes.position=h),s&&(i.morphAttributes.normal=d),r&&(i.morphAttributes.color=f),i.morphTargetsRelative=!0,i})}function jb(i,t){if(i.updateMorphTargets(),t.weights!==void 0)for(let e=0,n=t.weights.length;e<n;e++)i.morphTargetInfluences[e]=t.weights[e];if(t.extras&&Array.isArray(t.extras.targetNames)){const e=t.extras.targetNames;if(i.morphTargetInfluences.length===e.length){i.morphTargetDictionary={};for(let n=0,s=e.length;n<s;n++)i.morphTargetDictionary[e[n]]=n}else console.warn("THREE.GLTFLoader: Invalid extras.targetNames length. Ignoring names.")}}function Kb(i){let t;const e=i.extensions&&i.extensions[ie.KHR_DRACO_MESH_COMPRESSION];if(e?t="draco:"+e.bufferView+":"+e.indices+":"+Bu(e.attributes):t=i.indices+":"+Bu(i.attributes)+":"+i.mode,i.targets!==void 0)for(let n=0,s=i.targets.length;n<s;n++)t+=":"+Bu(i.targets[n]);return t}function Bu(i){let t="";const e=Object.keys(i).sort();for(let n=0,s=e.length;n<s;n++)t+=e[n]+":"+i[e[n]]+";";return t}function Xh(i){switch(i){case Int8Array:return 1/127;case Uint8Array:return 1/255;case Int16Array:return 1/32767;case Uint16Array:return 1/65535;default:throw new Error("THREE.GLTFLoader: Unsupported normalized accessor component type.")}}function $b(i){return i.search(/\.jpe?g($|\?)/i)>0||i.search(/^data\:image\/jpeg/)===0?"image/jpeg":i.search(/\.webp($|\?)/i)>0||i.search(/^data\:image\/webp/)===0?"image/webp":"image/png"}const Yb=new Gt;class Jb{constructor(t={},e={}){this.json=t,this.extensions={},this.plugins={},this.options=e,this.cache=new yb,this.associations=new Map,this.primitiveCache={},this.nodeCache={},this.meshCache={refs:{},uses:{}},this.cameraCache={refs:{},uses:{}},this.lightCache={refs:{},uses:{}},this.sourceCache={},this.textureCache={},this.nodeNamesUsed={};let n=!1,s=-1,r=!1,o=-1;if(typeof navigator<"u"){const a=navigator.userAgent;n=/^((?!chrome|android).)*safari/i.test(a)===!0;const c=a.match(/Version\/(\d+)/);s=n&&c?parseInt(c[1],10):-1,r=a.indexOf("Firefox")>-1,o=r?a.match(/Firefox\/([0-9]+)\./)[1]:-1}typeof createImageBitmap>"u"||n&&s<17||r&&o<98?this.textureLoader=new Lw(this.options.manager):this.textureLoader=new kw(this.options.manager),this.textureLoader.setCrossOrigin(this.options.crossOrigin),this.textureLoader.setRequestHeader(this.options.requestHeader),this.fileLoader=new G_(this.options.manager),this.fileLoader.setResponseType("arraybuffer"),this.options.crossOrigin==="use-credentials"&&this.fileLoader.setWithCredentials(!0)}setExtensions(t){this.extensions=t}setPlugins(t){this.plugins=t}parse(t,e){const n=this,s=this.json,r=this.extensions;this.cache.removeAll(),this.nodeCache={},this._invokeAll(function(o){return o._markDefs&&o._markDefs()}),Promise.all(this._invokeAll(function(o){return o.beforeRoot&&o.beforeRoot()})).then(function(){return Promise.all([n.getDependencies("scene"),n.getDependencies("animation"),n.getDependencies("camera")])}).then(function(o){const a={scene:o[0][s.scene||0],scenes:o[0],animations:o[1],cameras:o[2],asset:s.asset,parser:n,userData:{}};return Ns(r,a,s),Oi(a,s),Promise.all(n._invokeAll(function(c){return c.afterRoot&&c.afterRoot(a)})).then(function(){for(const c of a.scenes)c.updateMatrixWorld();t(a)})}).catch(e)}_markDefs(){const t=this.json.nodes||[],e=this.json.skins||[],n=this.json.meshes||[];for(let s=0,r=e.length;s<r;s++){const o=e[s].joints;for(let a=0,c=o.length;a<c;a++)t[o[a]].isBone=!0}for(let s=0,r=t.length;s<r;s++){const o=t[s];o.mesh!==void 0&&(this._addNodeRef(this.meshCache,o.mesh),o.skin!==void 0&&(n[o.mesh].isSkinnedMesh=!0)),o.camera!==void 0&&this._addNodeRef(this.cameraCache,o.camera)}}_addNodeRef(t,e){e!==void 0&&(t.refs[e]===void 0&&(t.refs[e]=t.uses[e]=0),t.refs[e]++)}_getNodeRef(t,e,n){if(t.refs[e]<=1)return n;const s=n.clone(),r=(o,a)=>{const c=this.associations.get(o);c!=null&&this.associations.set(a,c);for(const[l,h]of o.children.entries())r(h,a.children[l])};return r(n,s),s.name+="_instance_"+t.uses[e]++,s}_invokeOne(t){const e=Object.values(this.plugins);e.push(this);for(let n=0;n<e.length;n++){const s=t(e[n]);if(s)return s}return null}_invokeAll(t){const e=Object.values(this.plugins);e.unshift(this);const n=[];for(let s=0;s<e.length;s++){const r=t(e[s]);r&&n.push(r)}return n}getDependency(t,e){const n=t+":"+e;let s=this.cache.get(n);if(!s){switch(t){case"scene":s=this.loadScene(e);break;case"node":s=this._invokeOne(function(r){return r.loadNode&&r.loadNode(e)});break;case"mesh":s=this._invokeOne(function(r){return r.loadMesh&&r.loadMesh(e)});break;case"accessor":s=this.loadAccessor(e);break;case"bufferView":s=this._invokeOne(function(r){return r.loadBufferView&&r.loadBufferView(e)});break;case"buffer":s=this.loadBuffer(e);break;case"material":s=this._invokeOne(function(r){return r.loadMaterial&&r.loadMaterial(e)});break;case"texture":s=this._invokeOne(function(r){return r.loadTexture&&r.loadTexture(e)});break;case"skin":s=this.loadSkin(e);break;case"animation":s=this._invokeOne(function(r){return r.loadAnimation&&r.loadAnimation(e)});break;case"camera":s=this.loadCamera(e);break;default:if(s=this._invokeOne(function(r){return r!=this&&r.getDependency&&r.getDependency(t,e)}),!s)throw new Error("Unknown type: "+t);break}this.cache.add(n,s)}return s}getDependencies(t){let e=this.cache.get(t);if(!e){const n=this,s=this.json[t+(t==="mesh"?"es":"s")]||[];e=Promise.all(s.map(function(r,o){return n.getDependency(t,o)})),this.cache.add(t,e)}return e}loadBuffer(t){const e=this.json.buffers[t],n=this.fileLoader;if(e.type&&e.type!=="arraybuffer")throw new Error("THREE.GLTFLoader: "+e.type+" buffer type is not supported.");if(e.uri===void 0&&t===0)return Promise.resolve(this.extensions[ie.KHR_BINARY_GLTF].body);const s=this.options;return new Promise(function(r,o){n.load(ia.resolveURL(e.uri,s.path),r,void 0,function(){o(new Error('THREE.GLTFLoader: Failed to load buffer "'+e.uri+'".'))})})}loadBufferView(t){const e=this.json.bufferViews[t];return this.getDependency("buffer",e.buffer).then(function(n){const s=e.byteLength||0,r=e.byteOffset||0;return n.slice(r,r+s)})}loadAccessor(t){const e=this,n=this.json,s=this.json.accessors[t];if(s.bufferView===void 0&&s.sparse===void 0){const o=Fu[s.type],a=Hr[s.componentType],c=s.normalized===!0,l=new a(s.count*o);return Promise.resolve(new An(l,o,c))}const r=[];return s.bufferView!==void 0?r.push(this.getDependency("bufferView",s.bufferView)):r.push(null),s.sparse!==void 0&&(r.push(this.getDependency("bufferView",s.sparse.indices.bufferView)),r.push(this.getDependency("bufferView",s.sparse.values.bufferView))),Promise.all(r).then(function(o){const a=o[0],c=Fu[s.type],l=Hr[s.componentType],h=l.BYTES_PER_ELEMENT,d=h*c,f=s.byteOffset||0,p=s.bufferView!==void 0?n.bufferViews[s.bufferView].byteStride:void 0,v=s.normalized===!0;let x,m;if(p&&p!==d){const _=Math.floor(f/p),A="InterleavedBuffer:"+s.bufferView+":"+s.componentType+":"+_+":"+s.count;let S=e.cache.get(A);S||(x=new l(a,_*p,s.count*p/h),S=new M_(x,p/h),e.cache.add(A,S)),m=new fa(S,c,f%p/h,v)}else a===null?x=new l(s.count*c):x=new l(a,f,s.count*c),m=new An(x,c,v);if(s.sparse!==void 0){const _=Fu.SCALAR,A=Hr[s.sparse.indices.componentType],S=s.sparse.indices.byteOffset||0,b=s.sparse.values.byteOffset||0,F=new A(o[1],S,s.sparse.count*_),N=new l(o[2],b,s.sparse.count*c);a!==null&&(m=new An(m.array.slice(),m.itemSize,m.normalized)),m.normalized=!1;for(let M=0,w=F.length;M<w;M++){const C=F[M];if(m.setX(C,N[M*c]),c>=2&&m.setY(C,N[M*c+1]),c>=3&&m.setZ(C,N[M*c+2]),c>=4&&m.setW(C,N[M*c+3]),c>=5)throw new Error("THREE.GLTFLoader: Unsupported itemSize in sparse BufferAttribute.")}m.normalized=v}return m})}loadTexture(t){const e=this.json,n=this.options,r=e.textures[t].source,o=e.images[r];let a=this.textureLoader;if(o.uri){const c=n.manager.getHandler(o.uri);c!==null&&(a=c)}return this.loadTextureImage(t,r,a)}loadTextureImage(t,e,n){const s=this,r=this.json,o=r.textures[t],a=r.images[e],c=(a.uri||a.bufferView)+":"+o.sampler;if(this.textureCache[c])return this.textureCache[c];const l=this.loadImageSource(e,n).then(function(h){h.flipY=!1,h.name=o.name||a.name||"",h.name===""&&typeof a.uri=="string"&&a.uri.startsWith("data:image/")===!1&&(h.name=a.uri);const f=(r.samplers||{})[o.sampler]||{};return h.magFilter=bm[f.magFilter]||Fn,h.minFilter=bm[f.minFilter]||Fi,h.wrapS=Rm[f.wrapS]||Ks,h.wrapT=Rm[f.wrapT]||Ks,s.associations.set(h,{textures:t}),h}).catch(function(){return null});return this.textureCache[c]=l,l}loadImageSource(t,e){const n=this,s=this.json,r=this.options;if(this.sourceCache[t]!==void 0)return this.sourceCache[t].then(d=>d.clone());const o=s.images[t],a=self.URL||self.webkitURL;let c=o.uri||"",l=!1;if(o.bufferView!==void 0)c=n.getDependency("bufferView",o.bufferView).then(function(d){l=!0;const f=new Blob([d],{type:o.mimeType});return c=a.createObjectURL(f),c});else if(o.uri===void 0)throw new Error("THREE.GLTFLoader: Image "+t+" is missing URI and bufferView");const h=Promise.resolve(c).then(function(d){return new Promise(function(f,p){let v=f;e.isImageBitmapLoader===!0&&(v=function(x){const m=new Ze(x);m.needsUpdate=!0,f(m)}),e.load(ia.resolveURL(d,r.path),v,void 0,p)})}).then(function(d){return l===!0&&a.revokeObjectURL(c),Oi(d,o),d.userData.mimeType=o.mimeType||$b(o.uri),d}).catch(function(d){throw console.error("THREE.GLTFLoader: Couldn't load texture",c),d});return this.sourceCache[t]=h,h}assignTexture(t,e,n,s){const r=this;return this.getDependency("texture",n.index).then(function(o){if(!o)return null;if(n.texCoord!==void 0&&n.texCoord>0&&(o=o.clone(),o.channel=n.texCoord),r.extensions[ie.KHR_TEXTURE_TRANSFORM]){const a=n.extensions!==void 0?n.extensions[ie.KHR_TEXTURE_TRANSFORM]:void 0;if(a){const c=r.associations.get(o);o=r.extensions[ie.KHR_TEXTURE_TRANSFORM].extendTexture(o,a),r.associations.set(o,c)}}return s!==void 0&&(o.colorSpace=s),t[e]=o,o})}assignFinalMaterial(t){const e=t.geometry;let n=t.material;const s=e.attributes.tangent===void 0,r=e.attributes.color!==void 0,o=e.attributes.normal===void 0;if(t.isPoints){const a="PointsMaterial:"+n.uuid;let c=this.cache.get(a);c||(c=new C_,jn.prototype.copy.call(c,n),c.color.copy(n.color),c.map=n.map,c.sizeAttenuation=!1,this.cache.add(a,c)),n=c}else if(t.isLine){const a="LineBasicMaterial:"+n.uuid;let c=this.cache.get(a);c||(c=new I_,jn.prototype.copy.call(c,n),c.color.copy(n.color),c.map=n.map,this.cache.add(a,c)),n=c}if(s||r||o){let a="ClonedMaterial:"+n.uuid+":";s&&(a+="derivative-tangents:"),r&&(a+="vertex-colors:"),o&&(a+="flat-shading:");let c=this.cache.get(a);c||(c=n.clone(),r&&(c.vertexColors=!0),o&&(c.flatShading=!0),s&&(c.normalScale&&(c.normalScale.y*=-1),c.clearcoatNormalScale&&(c.clearcoatNormalScale.y*=-1)),this.cache.add(a,c),this.associations.set(c,this.associations.get(n))),n=c}t.material=n}getMaterialType(){return Od}loadMaterial(t){const e=this,n=this.json,s=this.extensions,r=n.materials[t];let o;const a={},c=r.extensions||{},l=[];if(c[ie.KHR_MATERIALS_UNLIT]){const d=s[ie.KHR_MATERIALS_UNLIT];o=d.getMaterialType(),l.push(d.extendParams(a,r,e))}else{const d=r.pbrMetallicRoughness||{};if(a.color=new It(1,1,1),a.opacity=1,Array.isArray(d.baseColorFactor)){const f=d.baseColorFactor;a.color.setRGB(f[0],f[1],f[2],fn),a.opacity=f[3]}d.baseColorTexture!==void 0&&l.push(e.assignTexture(a,"map",d.baseColorTexture,hn)),a.metalness=d.metallicFactor!==void 0?d.metallicFactor:1,a.roughness=d.roughnessFactor!==void 0?d.roughnessFactor:1,d.metallicRoughnessTexture!==void 0&&(l.push(e.assignTexture(a,"metalnessMap",d.metallicRoughnessTexture)),l.push(e.assignTexture(a,"roughnessMap",d.metallicRoughnessTexture))),o=this._invokeOne(function(f){return f.getMaterialType&&f.getMaterialType(t)}),l.push(Promise.all(this._invokeAll(function(f){return f.extendMaterialParams&&f.extendMaterialParams(t,a)})))}r.doubleSided===!0&&(a.side=ei);const h=r.alphaMode||Vu.OPAQUE;if(h===Vu.BLEND?(a.transparent=!0,a.depthWrite=!1):(a.transparent=!1,h===Vu.MASK&&(a.alphaTest=r.alphaCutoff!==void 0?r.alphaCutoff:.5)),r.normalTexture!==void 0&&o!==ks&&(l.push(e.assignTexture(a,"normalMap",r.normalTexture)),a.normalScale=new dt(1,1),r.normalTexture.scale!==void 0)){const d=r.normalTexture.scale;a.normalScale.set(d,d)}if(r.occlusionTexture!==void 0&&o!==ks&&(l.push(e.assignTexture(a,"aoMap",r.occlusionTexture)),r.occlusionTexture.strength!==void 0&&(a.aoMapIntensity=r.occlusionTexture.strength)),r.emissiveFactor!==void 0&&o!==ks){const d=r.emissiveFactor;a.emissive=new It().setRGB(d[0],d[1],d[2],fn)}return r.emissiveTexture!==void 0&&o!==ks&&l.push(e.assignTexture(a,"emissiveMap",r.emissiveTexture,hn)),Promise.all(l).then(function(){const d=new o(a);return r.name&&(d.name=r.name),Oi(d,r),e.associations.set(d,{materials:t}),r.extensions&&Ns(s,d,r),d})}createUniqueName(t){const e=_e.sanitizeNodeName(t||"");return e in this.nodeNamesUsed?e+"_"+ ++this.nodeNamesUsed[e]:(this.nodeNamesUsed[e]=0,e)}loadGeometries(t){const e=this,n=this.extensions,s=this.primitiveCache;function r(a){return n[ie.KHR_DRACO_MESH_COMPRESSION].decodePrimitive(a,e).then(function(c){return Im(c,a,e)})}const o=[];for(let a=0,c=t.length;a<c;a++){const l=t[a],h=Kb(l),d=s[h];if(d)o.push(d.promise);else{let f;l.extensions&&l.extensions[ie.KHR_DRACO_MESH_COMPRESSION]?f=r(l):f=Im(new mn,l,e),s[h]={primitive:l,promise:f},o.push(f)}}return Promise.all(o)}loadMesh(t){const e=this,n=this.json,s=this.extensions,r=n.meshes[t],o=r.primitives,a=[];for(let c=0,l=o.length;c<l;c++){const h=o[c].material===void 0?Xb(this.cache):this.getDependency("material",o[c].material);a.push(h)}return a.push(e.loadGeometries(o)),Promise.all(a).then(function(c){const l=c.slice(0,c.length-1),h=c[c.length-1],d=[];for(let p=0,v=h.length;p<v;p++){const x=h[p],m=o[p];let _;const A=l[p];if(m.mode===zn.TRIANGLES||m.mode===zn.TRIANGLE_STRIP||m.mode===zn.TRIANGLE_FAN||m.mode===void 0)_=r.isSkinnedMesh===!0?new VM(x,A):new ve(x,A),_.isSkinnedMesh===!0&&_.normalizeSkinWeights(),m.mode===zn.TRIANGLE_STRIP?_.geometry=Mm(_.geometry,a_):m.mode===zn.TRIANGLE_FAN&&(_.geometry=Mm(_.geometry,Nh));else if(m.mode===zn.LINES)_=new zM(x,A);else if(m.mode===zn.LINE_STRIP)_=new Dd(x,A);else if(m.mode===zn.LINE_LOOP)_=new HM(x,A);else if(m.mode===zn.POINTS)_=new GM(x,A);else throw new Error("THREE.GLTFLoader: Primitive mode unsupported: "+m.mode);Object.keys(_.geometry.morphAttributes).length>0&&jb(_,r),_.name=e.createUniqueName(r.name||"mesh_"+t),Oi(_,r),m.extensions&&Ns(s,_,m),e.assignFinalMaterial(_),d.push(_)}for(let p=0,v=d.length;p<v;p++)e.associations.set(d[p],{meshes:t,primitives:p});if(d.length===1)return r.extensions&&Ns(s,d[0],r),d[0];const f=new Xe;r.extensions&&Ns(s,f,r),e.associations.set(f,{meshes:t});for(let p=0,v=d.length;p<v;p++)f.add(d[p]);return f})}loadCamera(t){let e;const n=this.json.cameras[t],s=n[n.type];if(!s){console.warn("THREE.GLTFLoader: Missing camera parameters.");return}return n.type==="perspective"?e=new Pn(Tx.radToDeg(s.yfov),s.aspectRatio||1,s.znear||1,s.zfar||2e6):n.type==="orthographic"&&(e=new Id(-s.xmag,s.xmag,s.ymag,-s.ymag,s.znear,s.zfar)),n.name&&(e.name=this.createUniqueName(n.name)),Oi(e,n),Promise.resolve(e)}loadSkin(t){const e=this.json.skins[t],n=[];for(let s=0,r=e.joints.length;s<r;s++)n.push(this._loadNodeShallow(e.joints[s]));return e.inverseBindMatrices!==void 0?n.push(this.getDependency("accessor",e.inverseBindMatrices)):n.push(null),Promise.all(n).then(function(s){const r=s.pop(),o=s,a=[],c=[];for(let l=0,h=o.length;l<h;l++){const d=o[l];if(d){a.push(d);const f=new Gt;r!==null&&f.fromArray(r.array,l*16),c.push(f)}else console.warn('THREE.GLTFLoader: Joint "%s" could not be found.',e.joints[l])}return new Pd(a,c)})}loadAnimation(t){const e=this.json,n=this,s=e.animations[t],r=s.name?s.name:"animation_"+t,o=[],a=[],c=[],l=[],h=[];for(let d=0,f=s.channels.length;d<f;d++){const p=s.channels[d],v=s.samplers[p.sampler],x=p.target,m=x.node,_=s.parameters!==void 0?s.parameters[v.input]:v.input,A=s.parameters!==void 0?s.parameters[v.output]:v.output;x.node!==void 0&&(o.push(this.getDependency("node",m)),a.push(this.getDependency("accessor",_)),c.push(this.getDependency("accessor",A)),l.push(v),h.push(x))}return Promise.all([Promise.all(o),Promise.all(a),Promise.all(c),Promise.all(l),Promise.all(h)]).then(function(d){const f=d[0],p=d[1],v=d[2],x=d[3],m=d[4],_=[];for(let A=0,S=f.length;A<S;A++){const b=f[A],F=p[A],N=v[A],M=x[A],w=m[A];if(b===void 0)continue;b.updateMatrix&&b.updateMatrix();const C=n._createAnimationTracks(b,F,N,M,w);if(C)for(let y=0;y<C.length;y++)_.push(C[y])}return new zh(r,void 0,_)})}createNodeMesh(t){const e=this.json,n=this,s=e.nodes[t];return s.mesh===void 0?null:n.getDependency("mesh",s.mesh).then(function(r){const o=n._getNodeRef(n.meshCache,s.mesh,r);return s.weights!==void 0&&o.traverse(function(a){if(a.isMesh)for(let c=0,l=s.weights.length;c<l;c++)a.morphTargetInfluences[c]=s.weights[c]}),o})}loadNode(t){const e=this.json,n=this,s=e.nodes[t],r=n._loadNodeShallow(t),o=[],a=s.children||[];for(let l=0,h=a.length;l<h;l++)o.push(n.getDependency("node",a[l]));const c=s.skin===void 0?Promise.resolve(null):n.getDependency("skin",s.skin);return Promise.all([r,Promise.all(o),c]).then(function(l){const h=l[0],d=l[1],f=l[2];f!==null&&h.traverse(function(p){p.isSkinnedMesh&&p.bind(f,Yb)});for(let p=0,v=d.length;p<v;p++)h.add(d[p]);return h})}_loadNodeShallow(t){const e=this.json,n=this.extensions,s=this;if(this.nodeCache[t]!==void 0)return this.nodeCache[t];const r=e.nodes[t],o=r.name?s.createUniqueName(r.name):"",a=[],c=s._invokeOne(function(l){return l.createNodeMesh&&l.createNodeMesh(t)});return c&&a.push(c),r.camera!==void 0&&a.push(s.getDependency("camera",r.camera).then(function(l){return s._getNodeRef(s.cameraCache,r.camera,l)})),s._invokeAll(function(l){return l.createNodeAttachment&&l.createNodeAttachment(t)}).forEach(function(l){a.push(l)}),this.nodeCache[t]=Promise.all(a).then(function(l){let h;if(r.isBone===!0?h=new b_:l.length>1?h=new Xe:l.length===1?h=l[0]:h=new Me,h!==l[0])for(let d=0,f=l.length;d<f;d++)h.add(l[d]);if(r.name&&(h.userData.name=r.name,h.name=o),Oi(h,r),r.extensions&&Ns(n,h,r),r.matrix!==void 0){const d=new Gt;d.fromArray(r.matrix),h.applyMatrix4(d)}else r.translation!==void 0&&h.position.fromArray(r.translation),r.rotation!==void 0&&h.quaternion.fromArray(r.rotation),r.scale!==void 0&&h.scale.fromArray(r.scale);return s.associations.has(h)||s.associations.set(h,{}),s.associations.get(h).nodes=t,h}),this.nodeCache[t]}loadScene(t){const e=this.extensions,n=this.json.scenes[t],s=this,r=new Xe;n.name&&(r.name=s.createUniqueName(n.name)),Oi(r,n),n.extensions&&Ns(e,r,n);const o=n.nodes||[],a=[];for(let c=0,l=o.length;c<l;c++)a.push(s.getDependency("node",o[c]));return Promise.all(a).then(function(c){for(let h=0,d=c.length;h<d;h++)r.add(c[h]);const l=h=>{const d=new Map;for(const[f,p]of s.associations)(f instanceof jn||f instanceof Ze)&&d.set(f,p);return h.traverse(f=>{const p=s.associations.get(f);p!=null&&d.set(f,p)}),d};return s.associations=l(r),r})}_createAnimationTracks(t,e,n,s,r){const o=[],a=t.name?t.name:t.uuid,c=[];es[r.path]===es.weights?t.traverse(function(f){f.morphTargetInfluences&&c.push(f.name?f.name:f.uuid)}):c.push(a);let l;switch(es[r.path]){case es.weights:l=Qr;break;case es.rotation:l=to;break;case es.position:case es.scale:l=eo;break;default:switch(n.itemSize){case 1:l=Qr;break;case 2:case 3:default:l=eo;break}break}const h=s.interpolation!==void 0?Wb[s.interpolation]:ha,d=this._getArrayFromAccessor(n);for(let f=0,p=c.length;f<p;f++){const v=new l(c[f]+"."+es[r.path],e.array,d,h);s.interpolation==="CUBICSPLINE"&&this._createCubicSplineTrackInterpolant(v),o.push(v)}return o}_getArrayFromAccessor(t){let e=t.array;if(t.normalized){const n=Xh(e.constructor),s=new Float32Array(e.length);for(let r=0,o=e.length;r<o;r++)s[r]=e[r]*n;e=s}return e}_createCubicSplineTrackInterpolant(t){t.createInterpolant=function(n){const s=this instanceof to?Gb:J_;return new s(this.times,this.values,this.getValueSize()/3,n)},t.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline=!0}}function Zb(i,t,e){const n=t.attributes,s=new Ti;if(n.POSITION!==void 0){const a=e.json.accessors[n.POSITION],c=a.min,l=a.max;if(c!==void 0&&l!==void 0){if(s.set(new O(c[0],c[1],c[2]),new O(l[0],l[1],l[2])),a.normalized){const h=Xh(Hr[a.componentType]);s.min.multiplyScalar(h),s.max.multiplyScalar(h)}}else{console.warn("THREE.GLTFLoader: Missing min/max properties for accessor POSITION.");return}}else return;const r=t.targets;if(r!==void 0){const a=new O,c=new O;for(let l=0,h=r.length;l<h;l++){const d=r[l];if(d.POSITION!==void 0){const f=e.json.accessors[d.POSITION],p=f.min,v=f.max;if(p!==void 0&&v!==void 0){if(c.setX(Math.max(Math.abs(p[0]),Math.abs(v[0]))),c.setY(Math.max(Math.abs(p[1]),Math.abs(v[1]))),c.setZ(Math.max(Math.abs(p[2]),Math.abs(v[2]))),f.normalized){const x=Xh(Hr[f.componentType]);c.multiplyScalar(x)}a.max(c)}else console.warn("THREE.GLTFLoader: Missing min/max properties for accessor POSITION.")}}s.expandByVector(a)}i.boundingBox=s;const o=new Si;s.getCenter(o.center),o.radius=s.min.distanceTo(s.max)/2,i.boundingSphere=o}function Im(i,t,e){const n=t.attributes,s=[];function r(o,a){return e.getDependency("accessor",o).then(function(c){i.setAttribute(a,c)})}for(const o in n){const a=Wh[o]||o.toLowerCase();a in i.attributes||s.push(r(n[o],a))}if(t.indices!==void 0&&!i.index){const o=e.getDependency("accessor",t.indices).then(function(a){i.setIndex(a)});s.push(o)}return me.workingColorSpace!==fn&&"COLOR_0"in n&&console.warn(`THREE.GLTFLoader: Converting vertex colors from "srgb-linear" to "${me.workingColorSpace}" not supported.`),Oi(i,t),Zb(i,t,e),Promise.all(s).then(function(){return t.targets!==void 0?qb(i,t.targets,e):i})}function Qb(i){const t=new Map,e=new Map,n=i.clone();return Z_(i,n,function(s,r){t.set(r,s),e.set(s,r)}),n.traverse(function(s){if(!s.isSkinnedMesh)return;const r=s,o=t.get(s),a=o.skeleton.bones;r.skeleton=o.skeleton.clone(),r.bindMatrix.copy(o.bindMatrix),r.skeleton.bones=a.map(function(c){return e.get(c)}),r.bind(r.skeleton,r.bindMatrix)}),n}function Z_(i,t,e){e(i,t);for(let n=0;n<i.children.length;n++)Z_(i.children[n],t.children[n],e)}const t1=.12,e1=new vb,Cm=new Map;function n1(i){i.traverse(t=>{const e=t;if(!e.isMesh||!e.material)return;const n=Array.isArray(e.material)?e.material[0]:e.material,s=!!(e.geometry&&e.geometry.attributes&&e.geometry.attributes.color),r=n.map??null;r&&(r.colorSpace=hn);const o=s||r?new It(16777215):n.color?n.color.clone():new It(13421772),a=new gs({color:o,map:r,vertexColors:s,emissive:o.clone().multiplyScalar(t1),emissiveMap:r,transparent:!!n.transparent,opacity:n.opacity!=null?n.opacity:1,side:n.side??yi});a.name=n.name,e.material=a,e.castShadow=!0,e.receiveShadow=!0})}function Q_(i){let t=Cm.get(i);return t||(t=new Promise(e=>{e1.load(i,n=>{try{const s=n.scene;n1(s);const r=i1(s),o=new Ti().setFromObject(s);e({source:s,box:o,clips:n.animations??[],animated:r})}catch{e(null)}},void 0,()=>e(null))}),Cm.set(i,t),t)}function i1(i){let t=!1;return i.traverse(e=>{e.isSkinnedMesh&&(t=!0)}),t}function Hd(i){return Qb(i.source)}function t0(i){const t=Hd(i),e=i.box.max.x-i.box.min.x,n=i.box.max.y-i.box.min.y,s=i.box.max.z-i.box.min.z,o=1/(Math.max(e,n,s)||1),a=(i.box.min.x+i.box.max.x)/2,c=(i.box.min.z+i.box.max.z)/2;t.scale.setScalar(o),t.position.set(-a*o,-i.box.min.y*o-.5,-c*o);const l=new Xe;return l.add(t),Gd(i,l,t)}function tD(i,t){const e=Hd(i),n=i.box.max.x-i.box.min.x,s=i.box.max.y-i.box.min.y,r=i.box.max.z-i.box.min.z,o=Math.max(n,s,r)||1,a=t/o,c=(i.box.min.x+i.box.max.x)/2,l=(i.box.min.z+i.box.max.z)/2;e.scale.setScalar(a),e.position.set(-c*a,-i.box.min.y*a,-l*a);const h=new Xe;return h.add(e),Gd(i,h,e)}function eD(i){const t=Hd(i),e=new Xe;return e.add(t),Gd(i,e,t)}function Gd(i,t,e){if(i.animated&&i.clips.length){const n=new Qw(e);return{root:t,mixer:n,clips:i.clips}}return{root:t,clips:i.clips}}function nD(i,...t){for(const e of t){const n=e.toLowerCase(),s=i.find(r=>r.name.toLowerCase().includes(n));if(s)return s}return null}function e0(i){return"./".replace(/\/$/,"")+"/models/"+i}const qh=36e5,s1=24*qh,iD=["milk","egg"],Pm={goat:{type:"goat",name:"Goat",emoji:"🐐",produceId:"milk",produceEmoji:"🥛",produceEveryMs:12*qh,sellPrice:40},chicken:{type:"chicken",name:"Chicken",emoji:"🐔",produceId:"egg",produceEmoji:"🥚",produceEveryMs:8*qh,sellPrice:15}};function sD(i){const t=i==="milk"?Pm.goat:Pm.chicken;return{emoji:t.produceEmoji,name:t.produceId==="milk"?"Milk":"Eggs",sellPrice:t.sellPrice}}function r1(i,t,e){const n=Math.min(Math.max(0,e-i.lastFed),s1);return Math.min(t.produceEveryMs,Math.max(0,i.accruedMs)+n)}function o1(i,t,e){return r1(i,t,e)>=t.produceEveryMs}function rD(i,t,e){return{lastFed:e,accruedMs:0}}function oD(i,t,e){return t.produceId==="milk"&&o1(i,t,e)?"collect":"pet"}const Wd=[{id:"goat1",type:"goat",name:"Clover"},{id:"goat2",type:"goat",name:"Buttons"},{id:"chicken1",type:"chicken",name:"Henrietta"},{id:"chicken2",type:"chicken",name:"Nugget"},{id:"chicken3",type:"chicken",name:"Peep"}];function aD(i){const t={};for(const e of Wd)t[e.id]={id:e.id,type:e.type,name:e.name,bornAt:i,lastFed:i,accruedMs:0,lastPet:0};return t}function cD(i,t,e){const n=Wd.find(a=>a.id===i);if(!n)return null;const s={id:i,type:n.type,name:n.name,bornAt:e,lastFed:e,accruedMs:0,lastPet:0};if(!t||typeof t!="object")return s;const r=t,o={...s};return typeof r.bornAt=="number"&&isFinite(r.bornAt)&&(o.bornAt=r.bornAt),typeof r.lastFed=="number"&&isFinite(r.lastFed)&&(o.lastFed=r.lastFed),typeof r.accruedMs=="number"&&isFinite(r.accruedMs)&&r.accruedMs>=0&&(o.accruedMs=r.accruedMs),typeof r.lastPet=="number"&&isFinite(r.lastPet)&&(o.lastPet=r.lastPet),typeof r.name=="string"&&r.name.trim()&&(o.name=r.name.trim().slice(0,24)),o}function n0(i){let t=2166136261;for(let e=0;e<i.length;e++)t^=i.charCodeAt(e),t=Math.imul(t,16777619);return t>>>0}function i0(i){let t=i>>>0;return function(){t=t+1831565813|0;let e=Math.imul(t^t>>>15,1|t);return e=e+Math.imul(e^e>>>7,61|e)^e,((e^e>>>14)>>>0)/4294967296}}function s0(i){const e=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",hour:"numeric",minute:"numeric",hour12:!1}).formatToParts(new Date(i)),n=e.find(a=>a.type==="hour")?.value??"12",s=e.find(a=>a.type==="minute")?.value??"0",r=Number(n)%24,o=Number(s);return((r+o/60)%24+24)%24}const qo={sky:[.03,.05,.12],fog:[.04,.06,.14],hemiSky:[.12,.16,.32],hemiGround:[.05,.06,.09],hemiIntensity:.28,sunColor:[.55,.62,.85],sunIntensity:.12,ambIntensity:.06,starAlpha:1,windowGlow:1},a1={sky:[.85,.55,.42],fog:[.82,.6,.5],hemiSky:[.9,.75,.62],hemiGround:[.35,.28,.22],hemiIntensity:.65,sunColor:[1,.75,.55],sunIntensity:.75,ambIntensity:.14,starAlpha:.15,windowGlow:.6},Dm={sky:[.56,.75,.91],fog:[.66,.8,.88],hemiSky:[.87,.94,1],hemiGround:[.42,.55,.29],hemiIntensity:.85,sunColor:[1,.95,.84],sunIntensity:1.15,ambIntensity:.18,starAlpha:0,windowGlow:0},c1={sky:[.7,.4,.32],fog:[.68,.42,.38],hemiSky:[.75,.55,.5],hemiGround:[.3,.22,.2],hemiIntensity:.55,sunColor:[1,.55,.32],sunIntensity:.6,ambIntensity:.12,starAlpha:.25,windowGlow:.7},ku=[{h:0,f:qo},{h:5,f:qo},{h:6.5,f:a1},{h:8,f:Dm},{h:17.5,f:Dm},{h:19,f:c1},{h:20.5,f:qo},{h:24,f:qo}];function is(i,t,e){return i+(t-i)*e}function Go(i,t,e){return[is(i[0],t[0],e),is(i[1],t[1],e),is(i[2],t[2],e)]}function l1(i,t,e){return{sky:Go(i.sky,t.sky,e),fog:Go(i.fog,t.fog,e),hemiSky:Go(i.hemiSky,t.hemiSky,e),hemiGround:Go(i.hemiGround,t.hemiGround,e),hemiIntensity:is(i.hemiIntensity,t.hemiIntensity,e),sunColor:Go(i.sunColor,t.sunColor,e),sunIntensity:is(i.sunIntensity,t.sunIntensity,e),ambIntensity:is(i.ambIntensity,t.ambIntensity,e),starAlpha:is(i.starAlpha,t.starAlpha,e),windowGlow:is(i.windowGlow,t.windowGlow,e)}}function u1(i){const t=(i%24+24)%24;for(let e=0;e<ku.length-1;e++){const n=ku[e],s=ku[e+1];if(t>=n.h&&t<=s.h){const r=s.h===n.h?0:(t-n.h)/(s.h-n.h);return l1(n.f,s.f,r)}}return qo}function h1(i){return 45*Math.sin((i-6)/12*Math.PI)}function d1(i){return(i/24*360+200)%360}function lD(i){const t=s0(i);return{...u1(t),sunAzimuthDeg:d1(t),sunElevDeg:h1(t)}}const on={minX:22,maxX:52,minZ:-8,maxZ:14},an={minX:33,maxX:42,minZ:6,maxZ:13},Hs=.3,uD=4.6,os={x0:36.4,x1:39.6,z:an.minZ},Cl={x:(os.x0+os.x1)/2},r0=os.x1-os.x0,al={x:Cl.x,z:an.minZ-1.4},Lm={x:Cl.x,z:an.minZ+1.4},hi={x:46.5,z:9,r:1.7},Nm={x:on.minX,z0:1.4,z1:4.6},hD={x:on.minX,z:(Nm.z0+Nm.z1)/2};function dD(i){const t=s0(i);return t>=6&&t<8?"dawn":t>=8&&t<18.5?"day":t>=18.5&&t<20.5?"dusk":"night"}function f1(i,t,e,n=0){return i>e.minX+n&&i<e.maxX-n&&t>e.minZ+n&&t<e.maxZ-n}function Um(i,t){return f1(i,t,an,Hs)}function p1(i){const t=Hs*.5+.05,{minX:e,maxX:n,minZ:s,maxZ:r}=an,o=[{x1:e,z1:r,x2:n,z2:r,r:t},{x1:e,z1:s,x2:e,z2:r,r:t},{x1:n,z1:s,x2:n,z2:r,r:t},{x1:e,z1:s,x2:os.x0,z2:s,r:t},{x1:os.x1,z1:s,x2:n,z2:s,r:t}];return i||o.push({x1:os.x0,z1:s,x2:os.x1,z2:s,r:t}),o}function m1(i,t,e){const n=e.x2-e.x1,s=e.z2-e.z1,r=n*n+s*s||1e-6;let o=((i-e.x1)*n+(t-e.z1)*s)/r;o=Math.max(0,Math.min(1,o));const a=e.x1+n*o,c=e.z1+s*o;return{x:a,z:c,d:Math.hypot(i-a,t-c)}}function fD(i,t,e,n){let s=i,r=t;const o=p1(n);for(let a=0;a<2;a++){s=Math.max(on.minX+e,Math.min(on.maxX-e,s)),r=Math.max(on.minZ+e,Math.min(on.maxZ-e,r));for(const h of o){const d=m1(s,r,h),f=h.r+e;if(d.d<f){const p=d.d>1e-4?(s-d.x)/d.d:1,v=d.d>1e-4?(r-d.z)/d.d:0;s=d.x+p*f,r=d.z+v*f}}const c=Math.hypot(s-hi.x,r-hi.z),l=hi.r+e;if(c<l){const h=c>1e-4?(s-hi.x)/c:1,d=c>1e-4?(r-hi.z)/c:0;s=hi.x+h*l,r=hi.z+d*l}}return{x:s,z:r}}function pD(i){for(let t=0;t<14;t++){const e=i()<.78,n=on.minX+1.5+i()*(on.maxX-on.minX-3),s=e?on.minZ+1.5+i()*(an.minZ-1.5-(on.minZ+1.5)):on.minZ+1.5+i()*(on.maxZ-on.minZ-3);if(!(n>an.minX-1&&n<an.maxX+1&&s>an.minZ-1&&s<an.maxZ+1)&&!(Math.hypot(n-hi.x,s-hi.z)<hi.r+1.2))return{x:n,z:s}}return{x:al.x,z:al.z-3}}function mD(i,t,e,n){const s=Um(i,t),r=Um(e.x,e.z);if(s===r||!n)return e;const o=Math.abs(i-Cl.x)<r0/2-.12;return s&&!r?o?al:Lm:o?Lm:al}function gD(i){const t=i0(n0(i)^1374496523),e=an.minX+Hs+.7,n=an.maxX-Hs-.7,s=an.minZ+Hs+1.2,r=an.maxZ-Hs-.7;return{x:e+t()*(n-e),z:s+t()*(r-s)}}function _D(i){const t=i0(n0(i)^795480531);return{x:Cl.x+(t()-.5)*(r0+2.2),z:an.minZ-1.2-t()*1.6}}const g1=Wd.filter(i=>i.type==="chicken").map(i=>i.id),Om=[-2.6,0,2.6];function vD(i){const t=g1.indexOf(i),e=(an.minX+an.maxX)/2,n=t<0?0:Math.min(t,Om.length-1);return{x:e+Om[n],z:an.maxZ-Hs-1}}function yD(i,t){return`e_${i}_${Math.round(t)}`}function xD(){return{open:!1,at:0}}function ii(i,t={}){return new gs({color:new It(i),...t})}const _1={cx:24,cz:20},v1=8,Fm=5.5,Vm=6;let cl=[];function ED(){return cl}let Hc=null,Gc=null,o0=!1;function TD(){return o0}function SD(){return Q_(e0("buildings/farmhouse.glb")).then(i=>{if(!i||!Hc||!Gc)return;Hc.remove(Gc),Gc.traverse(e=>{const n=e;n.geometry&&n.geometry.dispose()});const t=t0(i).root;t.scale.set(v1,Fm,Vm),t.position.y=Fm/2,Hc.add(t),cl.forEach((e,n)=>{const s=e.userData.plane||null;s&&s.position.set(n===0?-2.4:-1.3,1.7,Vm/2+.06)}),o0=!0})}function y1(){const i=new Xe,{cx:t,cz:e}=_1,n=8,s=6,r=4,o=_s(t,e),a=new Xe,c=new ve(new We(n,r,s),ii("#e8dcc0"));c.position.set(0,r/2,0),c.castShadow=!0,c.receiveShadow=!0,a.add(c);const l=ii("#a6402f",{side:ei}),h=Math.hypot(n/2,2.4);for(const v of[-1,1]){const x=new ve(new us(h,s+.8),l);x.position.set(v*n/4,r+1.2,0),x.rotation.z=v*(Math.PI/2-Math.atan2(2.4,n/2)),x.rotation.y=Math.PI/2,x.castShadow=!0,a.add(x)}const d=ii("#d8ccb0");for(const v of[-1,1]){const x=new U_;x.moveTo(-n/2,0),x.lineTo(n/2,0),x.lineTo(0,2.4),x.closePath();const m=new ve(new Ud(x),d);m.position.set(0,r,v*s/2),a.add(m)}const f=new ve(new us(1.4,2.4),ii("#6b4a2b"));f.position.set(0,1.2,s/2+.02),a.add(f);const p=new ve(new We(.8,2,.8),ii("#8a5a45"));p.position.set(n/2-1.4,r+1.6,-s/4),p.castShadow=!0,a.add(p),i.add(a),cl=[];for(const v of[-n/2+1.4,n/2-1.4]){const x=new gs({color:"#fff4c2",emissive:new It("#ffcf6b"),emissiveIntensity:0}),m=new ve(new us(.7,.9),x);m.position.set(v,2.1,s/2+.02),m.renderOrder=3,x.userData.plane=m,i.add(m),cl.push(x)}return i.position.set(t,o,e),gb(t,e,n/2,s/2),Hc=i,Gc=a,{group:i,cx:t,cz:e}}function x1(){const i=new ve(new bl(Ke.r,40),new gs({color:new It("#3f7fb8"),transparent:!0,opacity:.78,emissive:new It("#123852")}));return i.rotation.x=-Math.PI/2,i.position.set(Ke.cx,Ke.waterY,Ke.cz),i.renderOrder=2,zd(Ke.cx,Ke.cz,Ke.r+.6),i}function E1(){const i=new Xe,t=ii("#7a5230"),e=ii("#8a6236"),n=De.half,s=De.cx,r=De.cz,o=new We(.3,1.3,.3),a=3,c=[[s-n,r-n],[s+n,r-n],[s+n,r+n],[s-n,r+n]];for(let l=0;l<4;l++){const[h,d]=c[l],[f,p]=c[(l+1)%4],v=l===1,x=Math.hypot(f-h,p-d),m=Math.round(x);for(let A=0;A<=m;A++){const S=A/m;if(v&&Math.abs(S-.5)<a/(2*x))continue;const F=h+(f-h)*S,N=d+(p-d)*S,M=new ve(o,t);M.position.set(F,_s(F,N)+.55,N),M.castShadow=!0,i.add(M)}const _=(A,S)=>{const b=h+(f-h)*((A+S)/2),F=d+(p-d)*((A+S)/2),N=x*(S-A);if(N<.2)return;const M=new ve(new We(N,.16,.16),e);M.position.set(b,_s(b,F)+.9,F),M.rotation.y=Math.atan2(p-d,f-h),i.add(M),_b(h+(f-h)*A,d+(p-d)*A,h+(f-h)*S,d+(p-d)*S,.28)};if(v){const A=a/(2*x);_(0,.5-A),_(.5+A,1)}else _(0,1)}return i}function a0(i){return()=>{i|=0,i=i+1831565813|0;let t=Math.imul(i^i>>>15,1|i);return t=t+Math.imul(t^t>>>7,61|t)^t,((t^t>>>14)>>>0)/4294967296}}function c0(i,t){return!(Math.abs(i-De.cx)<De.half+4&&Math.abs(t-De.cz)<De.half+4||Math.hypot(i-Ke.cx,t-Ke.cz)<Ke.r+5||Math.abs(i-24)<8&&Math.abs(t-20)<8||i>on.minX-3&&i<on.maxX+3&&t>on.minZ-3&&t<on.maxZ+3||Math.hypot(i,t)<8)}function T1(){const i=a0(4242),t=[];let e=0;for(;t.length<46&&e++<4e3;){const A=(i()*2-1)*(no-4),S=(i()*2-1)*(no-4);c0(A,S)&&t.push({x:A,z:S,s:.8+i()*.7})}const n=new Xe,s=new ti(.28,.4,2.4,6),r=new ui(1.5,8,6),o=ii("#6f4a2c"),a=ii("#4f7d3a"),c=ii("#5f9046"),l=new Qo(s,o,t.length),h=new Qo(r,a,t.length),d=new Qo(r,c,t.length);l.castShadow=h.castShadow=d.castShadow=!0;const f=new Me,p=[],v=[],x=[];t.forEach((A,S)=>{const b=_s(A.x,A.z);f.position.set(A.x,b+1.2*A.s,A.z),f.scale.setScalar(A.s),f.rotation.set(0,S*1.3,0),f.updateMatrix(),l.setMatrixAt(S,f.matrix),p.push(f.matrix.clone()),f.position.set(A.x,b+(2.6+.2)*A.s,A.z),f.scale.setScalar(A.s),f.updateMatrix(),h.setMatrixAt(S,f.matrix),v.push(f.matrix.clone()),f.position.set(A.x+.4*A.s,b+3.4*A.s,A.z-.3*A.s),f.scale.setScalar(A.s*.75),f.updateMatrix(),d.setMatrixAt(S,f.matrix),x.push(f.matrix.clone()),zd(A.x,A.z,.5*A.s)}),n.add(l,h,d);const m=new Gt().makeScale(0,0,0),_={name:"tree",meshes:[l,h,d],count:t.length,spotXZ:A=>({x:t[A].x,z:t[A].z}),setHidden:(A,S)=>{l.setMatrixAt(A,S?m:p[A]),h.setMatrixAt(A,S?m:v[A]),d.setMatrixAt(A,S?m:x[A]),l.instanceMatrix.needsUpdate=!0,h.instanceMatrix.needsUpdate=!0,d.instanceMatrix.needsUpdate=!0},makeProxy:A=>{const S=t[A],b=_s(S.x,S.z),F=new Xe,N=new ve(s,o.clone());N.position.set(S.x,b+1.2*S.s,S.z),N.scale.setScalar(S.s),N.rotation.y=A*1.3;const M=new ve(r,a.clone());M.position.set(S.x,b+2.8*S.s,S.z),M.scale.setScalar(S.s);const w=new ve(r,c.clone());return w.position.set(S.x+.4*S.s,b+3.4*S.s,S.z-.3*S.s),w.scale.setScalar(S.s*.75),F.add(N,M,w),F}};return{group:n,occluder:_}}function S1(){const i=a0(909),t=[];let e=0;for(;t.length<30&&e++<3e3;){const h=(i()*2-1)*(no-4),d=(i()*2-1)*(no-4);c0(h,d)&&t.push({x:h,z:d,s:.5+i()*.9,rx:i()*3,ry:i()*6,rz:i()*3})}const n=new pa(.7,0),s=ii("#8b8b8b"),r=new Qo(n,s,t.length);r.castShadow=r.receiveShadow=!0;const o=new Me,a=[];t.forEach((h,d)=>{const f=_s(h.x,h.z);o.position.set(h.x,f+.35*h.s,h.z),o.scale.set(h.s,h.s*.7,h.s),o.rotation.set(h.rx,h.ry,h.rz),o.updateMatrix(),r.setMatrixAt(d,o.matrix),a.push(o.matrix.clone()),zd(h.x,h.z,.55*h.s)});const c=new Gt().makeScale(0,0,0),l={name:"rock",meshes:[r],count:t.length,spotXZ:h=>({x:t[h].x,z:t[h].z}),setHidden:(h,d)=>{r.setMatrixAt(h,d?c:a[h]),r.instanceMatrix.needsUpdate=!0},makeProxy:h=>{const d=t[h],f=_s(d.x,d.z),p=new Xe,v=new ve(n,s.clone());return v.position.set(d.x,f+.35*d.s,d.z),v.scale.set(d.s,d.s*.7,d.s),v.rotation.set(d.rx,d.ry,d.rz),p.add(v),p}};return{mesh:r,occluder:l}}function AD(){const i=new Xe;i.add(E1()),i.add(x1());const t=y1();i.add(t.group);const e=T1();i.add(e.group);const n=S1();return i.add(n.mesh),{group:i,occluders:{trees:e.occluder,rocks:n.occluder,farmhouse:t.group}}}const l0="fl_world_v1";function A1(){try{const i=localStorage.getItem(l0);return i?W_(JSON.parse(i)):Ws()}catch{return Ws()}}class MD{async load(){return A1()}save(t){try{const e=X_(t);localStorage.setItem(l0,JSON.stringify(e))}catch{}}}const M1=()=>{};var Bm={};/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const u0=function(i){const t=[];let e=0;for(let n=0;n<i.length;n++){let s=i.charCodeAt(n);s<128?t[e++]=s:s<2048?(t[e++]=s>>6|192,t[e++]=s&63|128):(s&64512)===55296&&n+1<i.length&&(i.charCodeAt(n+1)&64512)===56320?(s=65536+((s&1023)<<10)+(i.charCodeAt(++n)&1023),t[e++]=s>>18|240,t[e++]=s>>12&63|128,t[e++]=s>>6&63|128,t[e++]=s&63|128):(t[e++]=s>>12|224,t[e++]=s>>6&63|128,t[e++]=s&63|128)}return t},w1=function(i){const t=[];let e=0,n=0;for(;e<i.length;){const s=i[e++];if(s<128)t[n++]=String.fromCharCode(s);else if(s>191&&s<224){const r=i[e++];t[n++]=String.fromCharCode((s&31)<<6|r&63)}else if(s>239&&s<365){const r=i[e++],o=i[e++],a=i[e++],c=((s&7)<<18|(r&63)<<12|(o&63)<<6|a&63)-65536;t[n++]=String.fromCharCode(55296+(c>>10)),t[n++]=String.fromCharCode(56320+(c&1023))}else{const r=i[e++],o=i[e++];t[n++]=String.fromCharCode((s&15)<<12|(r&63)<<6|o&63)}}return t.join("")},h0={byteToCharMap_:null,charToByteMap_:null,byteToCharMapWebSafe_:null,charToByteMapWebSafe_:null,ENCODED_VALS_BASE:"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",get ENCODED_VALS(){return this.ENCODED_VALS_BASE+"+/="},get ENCODED_VALS_WEBSAFE(){return this.ENCODED_VALS_BASE+"-_."},HAS_NATIVE_SUPPORT:typeof atob=="function",encodeByteArray(i,t){if(!Array.isArray(i))throw Error("encodeByteArray takes an array as a parameter");this.init_();const e=t?this.byteToCharMapWebSafe_:this.byteToCharMap_,n=[];for(let s=0;s<i.length;s+=3){const r=i[s],o=s+1<i.length,a=o?i[s+1]:0,c=s+2<i.length,l=c?i[s+2]:0,h=r>>2,d=(r&3)<<4|a>>4;let f=(a&15)<<2|l>>6,p=l&63;c||(p=64,o||(f=64)),n.push(e[h],e[d],e[f],e[p])}return n.join("")},encodeString(i,t){return this.HAS_NATIVE_SUPPORT&&!t?btoa(i):this.encodeByteArray(u0(i),t)},decodeString(i,t){return this.HAS_NATIVE_SUPPORT&&!t?atob(i):w1(this.decodeStringToByteArray(i,t))},decodeStringToByteArray(i,t){this.init_();const e=t?this.charToByteMapWebSafe_:this.charToByteMap_,n=[];for(let s=0;s<i.length;){const r=e[i.charAt(s++)],a=s<i.length?e[i.charAt(s)]:0;++s;const l=s<i.length?e[i.charAt(s)]:64;++s;const d=s<i.length?e[i.charAt(s)]:64;if(++s,r==null||a==null||l==null||d==null)throw new b1;const f=r<<2|a>>4;if(n.push(f),l!==64){const p=a<<4&240|l>>2;if(n.push(p),d!==64){const v=l<<6&192|d;n.push(v)}}}return n},init_(){if(!this.byteToCharMap_){this.byteToCharMap_={},this.charToByteMap_={},this.byteToCharMapWebSafe_={},this.charToByteMapWebSafe_={};for(let i=0;i<this.ENCODED_VALS.length;i++)this.byteToCharMap_[i]=this.ENCODED_VALS.charAt(i),this.charToByteMap_[this.byteToCharMap_[i]]=i,this.byteToCharMapWebSafe_[i]=this.ENCODED_VALS_WEBSAFE.charAt(i),this.charToByteMapWebSafe_[this.byteToCharMapWebSafe_[i]]=i,i>=this.ENCODED_VALS_BASE.length&&(this.charToByteMap_[this.ENCODED_VALS_WEBSAFE.charAt(i)]=i,this.charToByteMapWebSafe_[this.ENCODED_VALS.charAt(i)]=i)}}};class b1 extends Error{constructor(){super(...arguments),this.name="DecodeBase64StringError"}}const R1=function(i){const t=u0(i);return h0.encodeByteArray(t,!0)},ll=function(i){return R1(i).replace(/\./g,"")},I1=function(i){try{return h0.decodeString(i,!0)}catch(t){console.error("base64Decode failed: ",t)}return null};/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function C1(){if(typeof self<"u")return self;if(typeof window<"u")return window;if(typeof global<"u")return global;throw new Error("Unable to locate global object.")}/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const P1=()=>C1().__FIREBASE_DEFAULTS__,D1=()=>{if(typeof process>"u"||typeof Bm>"u")return;const i=Bm.__FIREBASE_DEFAULTS__;if(i)return JSON.parse(i)},L1=()=>{if(typeof document>"u")return;let i;try{i=document.cookie.match(/__FIREBASE_DEFAULTS__=([^;]+)/)}catch{return}const t=i&&I1(i[1]);return t&&JSON.parse(t)},Xd=()=>{try{return M1()||P1()||D1()||L1()}catch(i){console.info(`Unable to get __FIREBASE_DEFAULTS__ due to: ${i}`);return}},N1=i=>{var t,e;return(e=(t=Xd())===null||t===void 0?void 0:t.emulatorHosts)===null||e===void 0?void 0:e[i]},U1=i=>{const t=N1(i);if(!t)return;const e=t.lastIndexOf(":");if(e<=0||e+1===t.length)throw new Error(`Invalid host ${t} with no separate hostname and port!`);const n=parseInt(t.substring(e+1),10);return t[0]==="["?[t.substring(1,e-1),n]:[t.substring(0,e),n]},d0=()=>{var i;return(i=Xd())===null||i===void 0?void 0:i.config};/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class O1{constructor(){this.reject=()=>{},this.resolve=()=>{},this.promise=new Promise((t,e)=>{this.resolve=t,this.reject=e})}wrapCallback(t){return(e,n)=>{e?this.reject(e):this.resolve(n),typeof t=="function"&&(this.promise.catch(()=>{}),t.length===1?t(e):t(e,n))}}}/**
 * @license
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function qd(i){try{return(i.startsWith("http://")||i.startsWith("https://")?new URL(i).hostname:i).endsWith(".cloudworkstations.dev")}catch{return!1}}async function F1(i){return(await fetch(i,{credentials:"include"})).ok}/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function V1(i,t){if(i.uid)throw new Error('The "uid" field is no longer supported by mockUserToken. Please use "sub" instead for Firebase Auth User ID.');const e={alg:"none",type:"JWT"},n=t||"demo-project",s=i.iat||0,r=i.sub||i.user_id;if(!r)throw new Error("mockUserToken must contain 'sub' or 'user_id' field!");const o=Object.assign({iss:`https://securetoken.google.com/${n}`,aud:n,iat:s,exp:s+3600,auth_time:s,sub:r,user_id:r,firebase:{sign_in_provider:"custom",identities:{}}},i);return[ll(JSON.stringify(e)),ll(JSON.stringify(o)),""].join(".")}const sa={};function B1(){const i={prod:[],emulator:[]};for(const t of Object.keys(sa))sa[t]?i.emulator.push(t):i.prod.push(t);return i}function k1(i){let t=document.getElementById(i),e=!1;return t||(t=document.createElement("div"),t.setAttribute("id",i),e=!0),{created:e,element:t}}let km=!1;function z1(i,t){if(typeof window>"u"||typeof document>"u"||!qd(window.location.host)||sa[i]===t||sa[i]||km)return;sa[i]=t;function e(f){return`__firebase__banner__${f}`}const n="__firebase__banner",r=B1().prod.length>0;function o(){const f=document.getElementById(n);f&&f.remove()}function a(f){f.style.display="flex",f.style.background="#7faaf0",f.style.position="fixed",f.style.bottom="5px",f.style.left="5px",f.style.padding=".5em",f.style.borderRadius="5px",f.style.alignItems="center"}function c(f,p){f.setAttribute("width","24"),f.setAttribute("id",p),f.setAttribute("height","24"),f.setAttribute("viewBox","0 0 24 24"),f.setAttribute("fill","none"),f.style.marginLeft="-6px"}function l(){const f=document.createElement("span");return f.style.cursor="pointer",f.style.marginLeft="16px",f.style.fontSize="24px",f.innerHTML=" &times;",f.onclick=()=>{km=!0,o()},f}function h(f,p){f.setAttribute("id",p),f.innerText="Learn more",f.href="https://firebase.google.com/docs/studio/preview-apps#preview-backend",f.setAttribute("target","__blank"),f.style.paddingLeft="5px",f.style.textDecoration="underline"}function d(){const f=k1(n),p=e("text"),v=document.getElementById(p)||document.createElement("span"),x=e("learnmore"),m=document.getElementById(x)||document.createElement("a"),_=e("preprendIcon"),A=document.getElementById(_)||document.createElementNS("http://www.w3.org/2000/svg","svg");if(f.created){const S=f.element;a(S),h(m,x);const b=l();c(A,_),S.append(A,v,m,b),document.body.appendChild(S)}r?(v.innerText="Preview backend disconnected.",A.innerHTML=`<g clip-path="url(#clip0_6013_33858)">
<path d="M4.8 17.6L12 5.6L19.2 17.6H4.8ZM6.91667 16.4H17.0833L12 7.93333L6.91667 16.4ZM12 15.6C12.1667 15.6 12.3056 15.5444 12.4167 15.4333C12.5389 15.3111 12.6 15.1667 12.6 15C12.6 14.8333 12.5389 14.6944 12.4167 14.5833C12.3056 14.4611 12.1667 14.4 12 14.4C11.8333 14.4 11.6889 14.4611 11.5667 14.5833C11.4556 14.6944 11.4 14.8333 11.4 15C11.4 15.1667 11.4556 15.3111 11.5667 15.4333C11.6889 15.5444 11.8333 15.6 12 15.6ZM11.4 13.6H12.6V10.4H11.4V13.6Z" fill="#212121"/>
</g>
<defs>
<clipPath id="clip0_6013_33858">
<rect width="24" height="24" fill="white"/>
</clipPath>
</defs>`):(A.innerHTML=`<g clip-path="url(#clip0_6083_34804)">
<path d="M11.4 15.2H12.6V11.2H11.4V15.2ZM12 10C12.1667 10 12.3056 9.94444 12.4167 9.83333C12.5389 9.71111 12.6 9.56667 12.6 9.4C12.6 9.23333 12.5389 9.09444 12.4167 8.98333C12.3056 8.86111 12.1667 8.8 12 8.8C11.8333 8.8 11.6889 8.86111 11.5667 8.98333C11.4556 9.09444 11.4 9.23333 11.4 9.4C11.4 9.56667 11.4556 9.71111 11.5667 9.83333C11.6889 9.94444 11.8333 10 12 10ZM12 18.4C11.1222 18.4 10.2944 18.2333 9.51667 17.9C8.73889 17.5667 8.05556 17.1111 7.46667 16.5333C6.88889 15.9444 6.43333 15.2611 6.1 14.4833C5.76667 13.7056 5.6 12.8778 5.6 12C5.6 11.1111 5.76667 10.2833 6.1 9.51667C6.43333 8.73889 6.88889 8.06111 7.46667 7.48333C8.05556 6.89444 8.73889 6.43333 9.51667 6.1C10.2944 5.76667 11.1222 5.6 12 5.6C12.8889 5.6 13.7167 5.76667 14.4833 6.1C15.2611 6.43333 15.9389 6.89444 16.5167 7.48333C17.1056 8.06111 17.5667 8.73889 17.9 9.51667C18.2333 10.2833 18.4 11.1111 18.4 12C18.4 12.8778 18.2333 13.7056 17.9 14.4833C17.5667 15.2611 17.1056 15.9444 16.5167 16.5333C15.9389 17.1111 15.2611 17.5667 14.4833 17.9C13.7167 18.2333 12.8889 18.4 12 18.4ZM12 17.2C13.4444 17.2 14.6722 16.6944 15.6833 15.6833C16.6944 14.6722 17.2 13.4444 17.2 12C17.2 10.5556 16.6944 9.32778 15.6833 8.31667C14.6722 7.30555 13.4444 6.8 12 6.8C10.5556 6.8 9.32778 7.30555 8.31667 8.31667C7.30556 9.32778 6.8 10.5556 6.8 12C6.8 13.4444 7.30556 14.6722 8.31667 15.6833C9.32778 16.6944 10.5556 17.2 12 17.2Z" fill="#212121"/>
</g>
<defs>
<clipPath id="clip0_6083_34804">
<rect width="24" height="24" fill="white"/>
</clipPath>
</defs>`,v.innerText="Preview backend running in this workspace."),v.setAttribute("id",p)}document.readyState==="loading"?window.addEventListener("DOMContentLoaded",d):d()}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function H1(){return typeof navigator<"u"&&typeof navigator.userAgent=="string"?navigator.userAgent:""}function G1(){var i;const t=(i=Xd())===null||i===void 0?void 0:i.forceEnvironment;if(t==="node")return!0;if(t==="browser")return!1;try{return Object.prototype.toString.call(global.process)==="[object process]"}catch{return!1}}function W1(){return!G1()&&!!navigator.userAgent&&navigator.userAgent.includes("Safari")&&!navigator.userAgent.includes("Chrome")}function X1(){try{return typeof indexedDB=="object"}catch{return!1}}function q1(){return new Promise((i,t)=>{try{let e=!0;const n="validate-browser-context-for-indexeddb-analytics-module",s=self.indexedDB.open(n);s.onsuccess=()=>{s.result.close(),e||self.indexedDB.deleteDatabase(n),i(!0)},s.onupgradeneeded=()=>{e=!1},s.onerror=()=>{var r;t(((r=s.error)===null||r===void 0?void 0:r.message)||"")}}catch(e){t(e)}})}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const j1="FirebaseError";class po extends Error{constructor(t,e,n){super(e),this.code=t,this.customData=n,this.name=j1,Object.setPrototypeOf(this,po.prototype),Error.captureStackTrace&&Error.captureStackTrace(this,f0.prototype.create)}}class f0{constructor(t,e,n){this.service=t,this.serviceName=e,this.errors=n}create(t,...e){const n=e[0]||{},s=`${this.service}/${t}`,r=this.errors[t],o=r?K1(r,n):"Error",a=`${this.serviceName}: ${o} (${s}).`;return new po(s,a,n)}}function K1(i,t){return i.replace($1,(e,n)=>{const s=t[n];return s!=null?String(s):`<${n}?>`})}const $1=/\{\$([^}]+)}/g;function ul(i,t){if(i===t)return!0;const e=Object.keys(i),n=Object.keys(t);for(const s of e){if(!n.includes(s))return!1;const r=i[s],o=t[s];if(zm(r)&&zm(o)){if(!ul(r,o))return!1}else if(r!==o)return!1}for(const s of n)if(!e.includes(s))return!1;return!0}function zm(i){return i!==null&&typeof i=="object"}/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function io(i){return i&&i._delegate?i._delegate:i}class ya{constructor(t,e,n){this.name=t,this.instanceFactory=e,this.type=n,this.multipleInstances=!1,this.serviceProps={},this.instantiationMode="LAZY",this.onInstanceCreated=null}setInstantiationMode(t){return this.instantiationMode=t,this}setMultipleInstances(t){return this.multipleInstances=t,this}setServiceProps(t){return this.serviceProps=t,this}setInstanceCreatedCallback(t){return this.onInstanceCreated=t,this}}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Fs="[DEFAULT]";/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Y1{constructor(t,e){this.name=t,this.container=e,this.component=null,this.instances=new Map,this.instancesDeferred=new Map,this.instancesOptions=new Map,this.onInitCallbacks=new Map}get(t){const e=this.normalizeInstanceIdentifier(t);if(!this.instancesDeferred.has(e)){const n=new O1;if(this.instancesDeferred.set(e,n),this.isInitialized(e)||this.shouldAutoInitialize())try{const s=this.getOrInitializeService({instanceIdentifier:e});s&&n.resolve(s)}catch{}}return this.instancesDeferred.get(e).promise}getImmediate(t){var e;const n=this.normalizeInstanceIdentifier(t?.identifier),s=(e=t?.optional)!==null&&e!==void 0?e:!1;if(this.isInitialized(n)||this.shouldAutoInitialize())try{return this.getOrInitializeService({instanceIdentifier:n})}catch(r){if(s)return null;throw r}else{if(s)return null;throw Error(`Service ${this.name} is not available`)}}getComponent(){return this.component}setComponent(t){if(t.name!==this.name)throw Error(`Mismatching Component ${t.name} for Provider ${this.name}.`);if(this.component)throw Error(`Component for ${this.name} has already been provided`);if(this.component=t,!!this.shouldAutoInitialize()){if(Z1(t))try{this.getOrInitializeService({instanceIdentifier:Fs})}catch{}for(const[e,n]of this.instancesDeferred.entries()){const s=this.normalizeInstanceIdentifier(e);try{const r=this.getOrInitializeService({instanceIdentifier:s});n.resolve(r)}catch{}}}}clearInstance(t=Fs){this.instancesDeferred.delete(t),this.instancesOptions.delete(t),this.instances.delete(t)}async delete(){const t=Array.from(this.instances.values());await Promise.all([...t.filter(e=>"INTERNAL"in e).map(e=>e.INTERNAL.delete()),...t.filter(e=>"_delete"in e).map(e=>e._delete())])}isComponentSet(){return this.component!=null}isInitialized(t=Fs){return this.instances.has(t)}getOptions(t=Fs){return this.instancesOptions.get(t)||{}}initialize(t={}){const{options:e={}}=t,n=this.normalizeInstanceIdentifier(t.instanceIdentifier);if(this.isInitialized(n))throw Error(`${this.name}(${n}) has already been initialized`);if(!this.isComponentSet())throw Error(`Component ${this.name} has not been registered yet`);const s=this.getOrInitializeService({instanceIdentifier:n,options:e});for(const[r,o]of this.instancesDeferred.entries()){const a=this.normalizeInstanceIdentifier(r);n===a&&o.resolve(s)}return s}onInit(t,e){var n;const s=this.normalizeInstanceIdentifier(e),r=(n=this.onInitCallbacks.get(s))!==null&&n!==void 0?n:new Set;r.add(t),this.onInitCallbacks.set(s,r);const o=this.instances.get(s);return o&&t(o,s),()=>{r.delete(t)}}invokeOnInitCallbacks(t,e){const n=this.onInitCallbacks.get(e);if(n)for(const s of n)try{s(t,e)}catch{}}getOrInitializeService({instanceIdentifier:t,options:e={}}){let n=this.instances.get(t);if(!n&&this.component&&(n=this.component.instanceFactory(this.container,{instanceIdentifier:J1(t),options:e}),this.instances.set(t,n),this.instancesOptions.set(t,e),this.invokeOnInitCallbacks(n,t),this.component.onInstanceCreated))try{this.component.onInstanceCreated(this.container,t,n)}catch{}return n||null}normalizeInstanceIdentifier(t=Fs){return this.component?this.component.multipleInstances?t:Fs:t}shouldAutoInitialize(){return!!this.component&&this.component.instantiationMode!=="EXPLICIT"}}function J1(i){return i===Fs?void 0:i}function Z1(i){return i.instantiationMode==="EAGER"}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Q1{constructor(t){this.name=t,this.providers=new Map}addComponent(t){const e=this.getProvider(t.name);if(e.isComponentSet())throw new Error(`Component ${t.name} has already been registered with ${this.name}`);e.setComponent(t)}addOrOverwriteComponent(t){this.getProvider(t.name).isComponentSet()&&this.providers.delete(t.name),this.addComponent(t)}getProvider(t){if(this.providers.has(t))return this.providers.get(t);const e=new Y1(t,this);return this.providers.set(t,e),e}getProviders(){return Array.from(this.providers.values())}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */var le;(function(i){i[i.DEBUG=0]="DEBUG",i[i.VERBOSE=1]="VERBOSE",i[i.INFO=2]="INFO",i[i.WARN=3]="WARN",i[i.ERROR=4]="ERROR",i[i.SILENT=5]="SILENT"})(le||(le={}));const tR={debug:le.DEBUG,verbose:le.VERBOSE,info:le.INFO,warn:le.WARN,error:le.ERROR,silent:le.SILENT},eR=le.INFO,nR={[le.DEBUG]:"log",[le.VERBOSE]:"log",[le.INFO]:"info",[le.WARN]:"warn",[le.ERROR]:"error"},iR=(i,t,...e)=>{if(t<i.logLevel)return;const n=new Date().toISOString(),s=nR[t];if(s)console[s](`[${n}]  ${i.name}:`,...e);else throw new Error(`Attempted to log a message with an invalid logType (value: ${t})`)};class p0{constructor(t){this.name=t,this._logLevel=eR,this._logHandler=iR,this._userLogHandler=null}get logLevel(){return this._logLevel}set logLevel(t){if(!(t in le))throw new TypeError(`Invalid value "${t}" assigned to \`logLevel\``);this._logLevel=t}setLogLevel(t){this._logLevel=typeof t=="string"?tR[t]:t}get logHandler(){return this._logHandler}set logHandler(t){if(typeof t!="function")throw new TypeError("Value assigned to `logHandler` must be a function");this._logHandler=t}get userLogHandler(){return this._userLogHandler}set userLogHandler(t){this._userLogHandler=t}debug(...t){this._userLogHandler&&this._userLogHandler(this,le.DEBUG,...t),this._logHandler(this,le.DEBUG,...t)}log(...t){this._userLogHandler&&this._userLogHandler(this,le.VERBOSE,...t),this._logHandler(this,le.VERBOSE,...t)}info(...t){this._userLogHandler&&this._userLogHandler(this,le.INFO,...t),this._logHandler(this,le.INFO,...t)}warn(...t){this._userLogHandler&&this._userLogHandler(this,le.WARN,...t),this._logHandler(this,le.WARN,...t)}error(...t){this._userLogHandler&&this._userLogHandler(this,le.ERROR,...t),this._logHandler(this,le.ERROR,...t)}}const sR=(i,t)=>t.some(e=>i instanceof e);let Hm,Gm;function rR(){return Hm||(Hm=[IDBDatabase,IDBObjectStore,IDBIndex,IDBCursor,IDBTransaction])}function oR(){return Gm||(Gm=[IDBCursor.prototype.advance,IDBCursor.prototype.continue,IDBCursor.prototype.continuePrimaryKey])}const m0=new WeakMap,jh=new WeakMap,g0=new WeakMap,zu=new WeakMap,jd=new WeakMap;function aR(i){const t=new Promise((e,n)=>{const s=()=>{i.removeEventListener("success",r),i.removeEventListener("error",o)},r=()=>{e(hs(i.result)),s()},o=()=>{n(i.error),s()};i.addEventListener("success",r),i.addEventListener("error",o)});return t.then(e=>{e instanceof IDBCursor&&m0.set(e,i)}).catch(()=>{}),jd.set(t,i),t}function cR(i){if(jh.has(i))return;const t=new Promise((e,n)=>{const s=()=>{i.removeEventListener("complete",r),i.removeEventListener("error",o),i.removeEventListener("abort",o)},r=()=>{e(),s()},o=()=>{n(i.error||new DOMException("AbortError","AbortError")),s()};i.addEventListener("complete",r),i.addEventListener("error",o),i.addEventListener("abort",o)});jh.set(i,t)}let Kh={get(i,t,e){if(i instanceof IDBTransaction){if(t==="done")return jh.get(i);if(t==="objectStoreNames")return i.objectStoreNames||g0.get(i);if(t==="store")return e.objectStoreNames[1]?void 0:e.objectStore(e.objectStoreNames[0])}return hs(i[t])},set(i,t,e){return i[t]=e,!0},has(i,t){return i instanceof IDBTransaction&&(t==="done"||t==="store")?!0:t in i}};function lR(i){Kh=i(Kh)}function uR(i){return i===IDBDatabase.prototype.transaction&&!("objectStoreNames"in IDBTransaction.prototype)?function(t,...e){const n=i.call(Hu(this),t,...e);return g0.set(n,t.sort?t.sort():[t]),hs(n)}:oR().includes(i)?function(...t){return i.apply(Hu(this),t),hs(m0.get(this))}:function(...t){return hs(i.apply(Hu(this),t))}}function hR(i){return typeof i=="function"?uR(i):(i instanceof IDBTransaction&&cR(i),sR(i,rR())?new Proxy(i,Kh):i)}function hs(i){if(i instanceof IDBRequest)return aR(i);if(zu.has(i))return zu.get(i);const t=hR(i);return t!==i&&(zu.set(i,t),jd.set(t,i)),t}const Hu=i=>jd.get(i);function dR(i,t,{blocked:e,upgrade:n,blocking:s,terminated:r}={}){const o=indexedDB.open(i,t),a=hs(o);return n&&o.addEventListener("upgradeneeded",c=>{n(hs(o.result),c.oldVersion,c.newVersion,hs(o.transaction),c)}),e&&o.addEventListener("blocked",c=>e(c.oldVersion,c.newVersion,c)),a.then(c=>{r&&c.addEventListener("close",()=>r()),s&&c.addEventListener("versionchange",l=>s(l.oldVersion,l.newVersion,l))}).catch(()=>{}),a}const fR=["get","getKey","getAll","getAllKeys","count"],pR=["put","add","delete","clear"],Gu=new Map;function Wm(i,t){if(!(i instanceof IDBDatabase&&!(t in i)&&typeof t=="string"))return;if(Gu.get(t))return Gu.get(t);const e=t.replace(/FromIndex$/,""),n=t!==e,s=pR.includes(e);if(!(e in(n?IDBIndex:IDBObjectStore).prototype)||!(s||fR.includes(e)))return;const r=async function(o,...a){const c=this.transaction(o,s?"readwrite":"readonly");let l=c.store;return n&&(l=l.index(a.shift())),(await Promise.all([l[e](...a),s&&c.done]))[0]};return Gu.set(t,r),r}lR(i=>({...i,get:(t,e,n)=>Wm(t,e)||i.get(t,e,n),has:(t,e)=>!!Wm(t,e)||i.has(t,e)}));/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class mR{constructor(t){this.container=t}getPlatformInfoString(){return this.container.getProviders().map(e=>{if(gR(e)){const n=e.getImmediate();return`${n.library}/${n.version}`}else return null}).filter(e=>e).join(" ")}}function gR(i){const t=i.getComponent();return t?.type==="VERSION"}const $h="@firebase/app",Xm="0.13.2";/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const zi=new p0("@firebase/app"),_R="@firebase/app-compat",vR="@firebase/analytics-compat",yR="@firebase/analytics",xR="@firebase/app-check-compat",ER="@firebase/app-check",TR="@firebase/auth",SR="@firebase/auth-compat",AR="@firebase/database",MR="@firebase/data-connect",wR="@firebase/database-compat",bR="@firebase/functions",RR="@firebase/functions-compat",IR="@firebase/installations",CR="@firebase/installations-compat",PR="@firebase/messaging",DR="@firebase/messaging-compat",LR="@firebase/performance",NR="@firebase/performance-compat",UR="@firebase/remote-config",OR="@firebase/remote-config-compat",FR="@firebase/storage",VR="@firebase/storage-compat",BR="@firebase/firestore",kR="@firebase/ai",zR="@firebase/firestore-compat",HR="firebase",GR="11.10.0";/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Yh="[DEFAULT]",WR={[$h]:"fire-core",[_R]:"fire-core-compat",[yR]:"fire-analytics",[vR]:"fire-analytics-compat",[ER]:"fire-app-check",[xR]:"fire-app-check-compat",[TR]:"fire-auth",[SR]:"fire-auth-compat",[AR]:"fire-rtdb",[MR]:"fire-data-connect",[wR]:"fire-rtdb-compat",[bR]:"fire-fn",[RR]:"fire-fn-compat",[IR]:"fire-iid",[CR]:"fire-iid-compat",[PR]:"fire-fcm",[DR]:"fire-fcm-compat",[LR]:"fire-perf",[NR]:"fire-perf-compat",[UR]:"fire-rc",[OR]:"fire-rc-compat",[FR]:"fire-gcs",[VR]:"fire-gcs-compat",[BR]:"fire-fst",[zR]:"fire-fst-compat",[kR]:"fire-vertex","fire-js":"fire-js",[HR]:"fire-js-all"};/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const hl=new Map,XR=new Map,Jh=new Map;function qm(i,t){try{i.container.addComponent(t)}catch(e){zi.debug(`Component ${t.name} failed to register with FirebaseApp ${i.name}`,e)}}function dl(i){const t=i.name;if(Jh.has(t))return zi.debug(`There were multiple attempts to register component ${t}.`),!1;Jh.set(t,i);for(const e of hl.values())qm(e,i);for(const e of XR.values())qm(e,i);return!0}function qR(i,t){const e=i.container.getProvider("heartbeat").getImmediate({optional:!0});return e&&e.triggerHeartbeat(),i.container.getProvider(t)}function jR(i){return i==null?!1:i.settings!==void 0}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const KR={"no-app":"No Firebase App '{$appName}' has been created - call initializeApp() first","bad-app-name":"Illegal App name: '{$appName}'","duplicate-app":"Firebase App named '{$appName}' already exists with different options or config","app-deleted":"Firebase App named '{$appName}' already deleted","server-app-deleted":"Firebase Server App has been deleted","no-options":"Need to provide options, when not being deployed to hosting via source.","invalid-app-argument":"firebase.{$appName}() takes either no argument or a Firebase App instance.","invalid-log-argument":"First argument to `onLog` must be null or a function.","idb-open":"Error thrown when opening IndexedDB. Original error: {$originalErrorMessage}.","idb-get":"Error thrown when reading from IndexedDB. Original error: {$originalErrorMessage}.","idb-set":"Error thrown when writing to IndexedDB. Original error: {$originalErrorMessage}.","idb-delete":"Error thrown when deleting from IndexedDB. Original error: {$originalErrorMessage}.","finalization-registry-not-supported":"FirebaseServerApp deleteOnDeref field defined but the JS runtime does not support FinalizationRegistry.","invalid-server-app-environment":"FirebaseServerApp is not for use in browser environments."},ds=new f0("app","Firebase",KR);/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class $R{constructor(t,e,n){this._isDeleted=!1,this._options=Object.assign({},t),this._config=Object.assign({},e),this._name=e.name,this._automaticDataCollectionEnabled=e.automaticDataCollectionEnabled,this._container=n,this.container.addComponent(new ya("app",()=>this,"PUBLIC"))}get automaticDataCollectionEnabled(){return this.checkDestroyed(),this._automaticDataCollectionEnabled}set automaticDataCollectionEnabled(t){this.checkDestroyed(),this._automaticDataCollectionEnabled=t}get name(){return this.checkDestroyed(),this._name}get options(){return this.checkDestroyed(),this._options}get config(){return this.checkDestroyed(),this._config}get container(){return this._container}get isDeleted(){return this._isDeleted}set isDeleted(t){this._isDeleted=t}checkDestroyed(){if(this.isDeleted)throw ds.create("app-deleted",{appName:this._name})}}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const YR=GR;function _0(i,t={}){let e=i;typeof t!="object"&&(t={name:t});const n=Object.assign({name:Yh,automaticDataCollectionEnabled:!0},t),s=n.name;if(typeof s!="string"||!s)throw ds.create("bad-app-name",{appName:String(s)});if(e||(e=d0()),!e)throw ds.create("no-options");const r=hl.get(s);if(r){if(ul(e,r.options)&&ul(n,r.config))return r;throw ds.create("duplicate-app",{appName:s})}const o=new Q1(s);for(const c of Jh.values())o.addComponent(c);const a=new $R(e,n,o);return hl.set(s,a),a}function JR(i=Yh){const t=hl.get(i);if(!t&&i===Yh&&d0())return _0();if(!t)throw ds.create("no-app",{appName:i});return t}function Gr(i,t,e){var n;let s=(n=WR[i])!==null&&n!==void 0?n:i;e&&(s+=`-${e}`);const r=s.match(/\s|\//),o=t.match(/\s|\//);if(r||o){const a=[`Unable to register library "${s}" with version "${t}":`];r&&a.push(`library name "${s}" contains illegal characters (whitespace or "/")`),r&&o&&a.push("and"),o&&a.push(`version name "${t}" contains illegal characters (whitespace or "/")`),zi.warn(a.join(" "));return}dl(new ya(`${s}-version`,()=>({library:s,version:t}),"VERSION"))}/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const ZR="firebase-heartbeat-database",QR=1,xa="firebase-heartbeat-store";let Wu=null;function v0(){return Wu||(Wu=dR(ZR,QR,{upgrade:(i,t)=>{switch(t){case 0:try{i.createObjectStore(xa)}catch(e){console.warn(e)}}}}).catch(i=>{throw ds.create("idb-open",{originalErrorMessage:i.message})})),Wu}async function tI(i){try{const e=(await v0()).transaction(xa),n=await e.objectStore(xa).get(y0(i));return await e.done,n}catch(t){if(t instanceof po)zi.warn(t.message);else{const e=ds.create("idb-get",{originalErrorMessage:t?.message});zi.warn(e.message)}}}async function jm(i,t){try{const n=(await v0()).transaction(xa,"readwrite");await n.objectStore(xa).put(t,y0(i)),await n.done}catch(e){if(e instanceof po)zi.warn(e.message);else{const n=ds.create("idb-set",{originalErrorMessage:e?.message});zi.warn(n.message)}}}function y0(i){return`${i.name}!${i.options.appId}`}/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const eI=1024,nI=30;class iI{constructor(t){this.container=t,this._heartbeatsCache=null;const e=this.container.getProvider("app").getImmediate();this._storage=new rI(e),this._heartbeatsCachePromise=this._storage.read().then(n=>(this._heartbeatsCache=n,n))}async triggerHeartbeat(){var t,e;try{const s=this.container.getProvider("platform-logger").getImmediate().getPlatformInfoString(),r=Km();if(((t=this._heartbeatsCache)===null||t===void 0?void 0:t.heartbeats)==null&&(this._heartbeatsCache=await this._heartbeatsCachePromise,((e=this._heartbeatsCache)===null||e===void 0?void 0:e.heartbeats)==null)||this._heartbeatsCache.lastSentHeartbeatDate===r||this._heartbeatsCache.heartbeats.some(o=>o.date===r))return;if(this._heartbeatsCache.heartbeats.push({date:r,agent:s}),this._heartbeatsCache.heartbeats.length>nI){const o=oI(this._heartbeatsCache.heartbeats);this._heartbeatsCache.heartbeats.splice(o,1)}return this._storage.overwrite(this._heartbeatsCache)}catch(n){zi.warn(n)}}async getHeartbeatsHeader(){var t;try{if(this._heartbeatsCache===null&&await this._heartbeatsCachePromise,((t=this._heartbeatsCache)===null||t===void 0?void 0:t.heartbeats)==null||this._heartbeatsCache.heartbeats.length===0)return"";const e=Km(),{heartbeatsToSend:n,unsentEntries:s}=sI(this._heartbeatsCache.heartbeats),r=ll(JSON.stringify({version:2,heartbeats:n}));return this._heartbeatsCache.lastSentHeartbeatDate=e,s.length>0?(this._heartbeatsCache.heartbeats=s,await this._storage.overwrite(this._heartbeatsCache)):(this._heartbeatsCache.heartbeats=[],this._storage.overwrite(this._heartbeatsCache)),r}catch(e){return zi.warn(e),""}}}function Km(){return new Date().toISOString().substring(0,10)}function sI(i,t=eI){const e=[];let n=i.slice();for(const s of i){const r=e.find(o=>o.agent===s.agent);if(r){if(r.dates.push(s.date),$m(e)>t){r.dates.pop();break}}else if(e.push({agent:s.agent,dates:[s.date]}),$m(e)>t){e.pop();break}n=n.slice(1)}return{heartbeatsToSend:e,unsentEntries:n}}class rI{constructor(t){this.app=t,this._canUseIndexedDBPromise=this.runIndexedDBEnvironmentCheck()}async runIndexedDBEnvironmentCheck(){return X1()?q1().then(()=>!0).catch(()=>!1):!1}async read(){if(await this._canUseIndexedDBPromise){const e=await tI(this.app);return e?.heartbeats?e:{heartbeats:[]}}else return{heartbeats:[]}}async overwrite(t){var e;if(await this._canUseIndexedDBPromise){const s=await this.read();return jm(this.app,{lastSentHeartbeatDate:(e=t.lastSentHeartbeatDate)!==null&&e!==void 0?e:s.lastSentHeartbeatDate,heartbeats:t.heartbeats})}else return}async add(t){var e;if(await this._canUseIndexedDBPromise){const s=await this.read();return jm(this.app,{lastSentHeartbeatDate:(e=t.lastSentHeartbeatDate)!==null&&e!==void 0?e:s.lastSentHeartbeatDate,heartbeats:[...s.heartbeats,...t.heartbeats]})}else return}}function $m(i){return ll(JSON.stringify({version:2,heartbeats:i})).length}function oI(i){if(i.length===0)return-1;let t=0,e=i[0].date;for(let n=1;n<i.length;n++)i[n].date<e&&(e=i[n].date,t=n);return t}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function aI(i){dl(new ya("platform-logger",t=>new mR(t),"PRIVATE")),dl(new ya("heartbeat",t=>new iI(t),"PRIVATE")),Gr($h,Xm,i),Gr($h,Xm,"esm2017"),Gr("fire-js","")}aI("");var Ym=typeof globalThis<"u"?globalThis:typeof window<"u"?window:typeof global<"u"?global:typeof self<"u"?self:{};/** @license
Copyright The Closure Library Authors.
SPDX-License-Identifier: Apache-2.0
*/var fs,x0;(function(){var i;/** @license

 Copyright The Closure Library Authors.
 SPDX-License-Identifier: Apache-2.0
*/function t(M,w){function C(){}C.prototype=w.prototype,M.D=w.prototype,M.prototype=new C,M.prototype.constructor=M,M.C=function(y,E,L){for(var R=Array(arguments.length-2),q=2;q<arguments.length;q++)R[q-2]=arguments[q];return w.prototype[E].apply(y,R)}}function e(){this.blockSize=-1}function n(){this.blockSize=-1,this.blockSize=64,this.g=Array(4),this.B=Array(this.blockSize),this.o=this.h=0,this.s()}t(n,e),n.prototype.s=function(){this.g[0]=1732584193,this.g[1]=4023233417,this.g[2]=2562383102,this.g[3]=271733878,this.o=this.h=0};function s(M,w,C){C||(C=0);var y=Array(16);if(typeof w=="string")for(var E=0;16>E;++E)y[E]=w.charCodeAt(C++)|w.charCodeAt(C++)<<8|w.charCodeAt(C++)<<16|w.charCodeAt(C++)<<24;else for(E=0;16>E;++E)y[E]=w[C++]|w[C++]<<8|w[C++]<<16|w[C++]<<24;w=M.g[0],C=M.g[1],E=M.g[2];var L=M.g[3],R=w+(L^C&(E^L))+y[0]+3614090360&4294967295;w=C+(R<<7&4294967295|R>>>25),R=L+(E^w&(C^E))+y[1]+3905402710&4294967295,L=w+(R<<12&4294967295|R>>>20),R=E+(C^L&(w^C))+y[2]+606105819&4294967295,E=L+(R<<17&4294967295|R>>>15),R=C+(w^E&(L^w))+y[3]+3250441966&4294967295,C=E+(R<<22&4294967295|R>>>10),R=w+(L^C&(E^L))+y[4]+4118548399&4294967295,w=C+(R<<7&4294967295|R>>>25),R=L+(E^w&(C^E))+y[5]+1200080426&4294967295,L=w+(R<<12&4294967295|R>>>20),R=E+(C^L&(w^C))+y[6]+2821735955&4294967295,E=L+(R<<17&4294967295|R>>>15),R=C+(w^E&(L^w))+y[7]+4249261313&4294967295,C=E+(R<<22&4294967295|R>>>10),R=w+(L^C&(E^L))+y[8]+1770035416&4294967295,w=C+(R<<7&4294967295|R>>>25),R=L+(E^w&(C^E))+y[9]+2336552879&4294967295,L=w+(R<<12&4294967295|R>>>20),R=E+(C^L&(w^C))+y[10]+4294925233&4294967295,E=L+(R<<17&4294967295|R>>>15),R=C+(w^E&(L^w))+y[11]+2304563134&4294967295,C=E+(R<<22&4294967295|R>>>10),R=w+(L^C&(E^L))+y[12]+1804603682&4294967295,w=C+(R<<7&4294967295|R>>>25),R=L+(E^w&(C^E))+y[13]+4254626195&4294967295,L=w+(R<<12&4294967295|R>>>20),R=E+(C^L&(w^C))+y[14]+2792965006&4294967295,E=L+(R<<17&4294967295|R>>>15),R=C+(w^E&(L^w))+y[15]+1236535329&4294967295,C=E+(R<<22&4294967295|R>>>10),R=w+(E^L&(C^E))+y[1]+4129170786&4294967295,w=C+(R<<5&4294967295|R>>>27),R=L+(C^E&(w^C))+y[6]+3225465664&4294967295,L=w+(R<<9&4294967295|R>>>23),R=E+(w^C&(L^w))+y[11]+643717713&4294967295,E=L+(R<<14&4294967295|R>>>18),R=C+(L^w&(E^L))+y[0]+3921069994&4294967295,C=E+(R<<20&4294967295|R>>>12),R=w+(E^L&(C^E))+y[5]+3593408605&4294967295,w=C+(R<<5&4294967295|R>>>27),R=L+(C^E&(w^C))+y[10]+38016083&4294967295,L=w+(R<<9&4294967295|R>>>23),R=E+(w^C&(L^w))+y[15]+3634488961&4294967295,E=L+(R<<14&4294967295|R>>>18),R=C+(L^w&(E^L))+y[4]+3889429448&4294967295,C=E+(R<<20&4294967295|R>>>12),R=w+(E^L&(C^E))+y[9]+568446438&4294967295,w=C+(R<<5&4294967295|R>>>27),R=L+(C^E&(w^C))+y[14]+3275163606&4294967295,L=w+(R<<9&4294967295|R>>>23),R=E+(w^C&(L^w))+y[3]+4107603335&4294967295,E=L+(R<<14&4294967295|R>>>18),R=C+(L^w&(E^L))+y[8]+1163531501&4294967295,C=E+(R<<20&4294967295|R>>>12),R=w+(E^L&(C^E))+y[13]+2850285829&4294967295,w=C+(R<<5&4294967295|R>>>27),R=L+(C^E&(w^C))+y[2]+4243563512&4294967295,L=w+(R<<9&4294967295|R>>>23),R=E+(w^C&(L^w))+y[7]+1735328473&4294967295,E=L+(R<<14&4294967295|R>>>18),R=C+(L^w&(E^L))+y[12]+2368359562&4294967295,C=E+(R<<20&4294967295|R>>>12),R=w+(C^E^L)+y[5]+4294588738&4294967295,w=C+(R<<4&4294967295|R>>>28),R=L+(w^C^E)+y[8]+2272392833&4294967295,L=w+(R<<11&4294967295|R>>>21),R=E+(L^w^C)+y[11]+1839030562&4294967295,E=L+(R<<16&4294967295|R>>>16),R=C+(E^L^w)+y[14]+4259657740&4294967295,C=E+(R<<23&4294967295|R>>>9),R=w+(C^E^L)+y[1]+2763975236&4294967295,w=C+(R<<4&4294967295|R>>>28),R=L+(w^C^E)+y[4]+1272893353&4294967295,L=w+(R<<11&4294967295|R>>>21),R=E+(L^w^C)+y[7]+4139469664&4294967295,E=L+(R<<16&4294967295|R>>>16),R=C+(E^L^w)+y[10]+3200236656&4294967295,C=E+(R<<23&4294967295|R>>>9),R=w+(C^E^L)+y[13]+681279174&4294967295,w=C+(R<<4&4294967295|R>>>28),R=L+(w^C^E)+y[0]+3936430074&4294967295,L=w+(R<<11&4294967295|R>>>21),R=E+(L^w^C)+y[3]+3572445317&4294967295,E=L+(R<<16&4294967295|R>>>16),R=C+(E^L^w)+y[6]+76029189&4294967295,C=E+(R<<23&4294967295|R>>>9),R=w+(C^E^L)+y[9]+3654602809&4294967295,w=C+(R<<4&4294967295|R>>>28),R=L+(w^C^E)+y[12]+3873151461&4294967295,L=w+(R<<11&4294967295|R>>>21),R=E+(L^w^C)+y[15]+530742520&4294967295,E=L+(R<<16&4294967295|R>>>16),R=C+(E^L^w)+y[2]+3299628645&4294967295,C=E+(R<<23&4294967295|R>>>9),R=w+(E^(C|~L))+y[0]+4096336452&4294967295,w=C+(R<<6&4294967295|R>>>26),R=L+(C^(w|~E))+y[7]+1126891415&4294967295,L=w+(R<<10&4294967295|R>>>22),R=E+(w^(L|~C))+y[14]+2878612391&4294967295,E=L+(R<<15&4294967295|R>>>17),R=C+(L^(E|~w))+y[5]+4237533241&4294967295,C=E+(R<<21&4294967295|R>>>11),R=w+(E^(C|~L))+y[12]+1700485571&4294967295,w=C+(R<<6&4294967295|R>>>26),R=L+(C^(w|~E))+y[3]+2399980690&4294967295,L=w+(R<<10&4294967295|R>>>22),R=E+(w^(L|~C))+y[10]+4293915773&4294967295,E=L+(R<<15&4294967295|R>>>17),R=C+(L^(E|~w))+y[1]+2240044497&4294967295,C=E+(R<<21&4294967295|R>>>11),R=w+(E^(C|~L))+y[8]+1873313359&4294967295,w=C+(R<<6&4294967295|R>>>26),R=L+(C^(w|~E))+y[15]+4264355552&4294967295,L=w+(R<<10&4294967295|R>>>22),R=E+(w^(L|~C))+y[6]+2734768916&4294967295,E=L+(R<<15&4294967295|R>>>17),R=C+(L^(E|~w))+y[13]+1309151649&4294967295,C=E+(R<<21&4294967295|R>>>11),R=w+(E^(C|~L))+y[4]+4149444226&4294967295,w=C+(R<<6&4294967295|R>>>26),R=L+(C^(w|~E))+y[11]+3174756917&4294967295,L=w+(R<<10&4294967295|R>>>22),R=E+(w^(L|~C))+y[2]+718787259&4294967295,E=L+(R<<15&4294967295|R>>>17),R=C+(L^(E|~w))+y[9]+3951481745&4294967295,M.g[0]=M.g[0]+w&4294967295,M.g[1]=M.g[1]+(E+(R<<21&4294967295|R>>>11))&4294967295,M.g[2]=M.g[2]+E&4294967295,M.g[3]=M.g[3]+L&4294967295}n.prototype.u=function(M,w){w===void 0&&(w=M.length);for(var C=w-this.blockSize,y=this.B,E=this.h,L=0;L<w;){if(E==0)for(;L<=C;)s(this,M,L),L+=this.blockSize;if(typeof M=="string"){for(;L<w;)if(y[E++]=M.charCodeAt(L++),E==this.blockSize){s(this,y),E=0;break}}else for(;L<w;)if(y[E++]=M[L++],E==this.blockSize){s(this,y),E=0;break}}this.h=E,this.o+=w},n.prototype.v=function(){var M=Array((56>this.h?this.blockSize:2*this.blockSize)-this.h);M[0]=128;for(var w=1;w<M.length-8;++w)M[w]=0;var C=8*this.o;for(w=M.length-8;w<M.length;++w)M[w]=C&255,C/=256;for(this.u(M),M=Array(16),w=C=0;4>w;++w)for(var y=0;32>y;y+=8)M[C++]=this.g[w]>>>y&255;return M};function r(M,w){var C=a;return Object.prototype.hasOwnProperty.call(C,M)?C[M]:C[M]=w(M)}function o(M,w){this.h=w;for(var C=[],y=!0,E=M.length-1;0<=E;E--){var L=M[E]|0;y&&L==w||(C[E]=L,y=!1)}this.g=C}var a={};function c(M){return-128<=M&&128>M?r(M,function(w){return new o([w|0],0>w?-1:0)}):new o([M|0],0>M?-1:0)}function l(M){if(isNaN(M)||!isFinite(M))return d;if(0>M)return m(l(-M));for(var w=[],C=1,y=0;M>=C;y++)w[y]=M/C|0,C*=4294967296;return new o(w,0)}function h(M,w){if(M.length==0)throw Error("number format error: empty string");if(w=w||10,2>w||36<w)throw Error("radix out of range: "+w);if(M.charAt(0)=="-")return m(h(M.substring(1),w));if(0<=M.indexOf("-"))throw Error('number format error: interior "-" character');for(var C=l(Math.pow(w,8)),y=d,E=0;E<M.length;E+=8){var L=Math.min(8,M.length-E),R=parseInt(M.substring(E,E+L),w);8>L?(L=l(Math.pow(w,L)),y=y.j(L).add(l(R))):(y=y.j(C),y=y.add(l(R)))}return y}var d=c(0),f=c(1),p=c(16777216);i=o.prototype,i.m=function(){if(x(this))return-m(this).m();for(var M=0,w=1,C=0;C<this.g.length;C++){var y=this.i(C);M+=(0<=y?y:4294967296+y)*w,w*=4294967296}return M},i.toString=function(M){if(M=M||10,2>M||36<M)throw Error("radix out of range: "+M);if(v(this))return"0";if(x(this))return"-"+m(this).toString(M);for(var w=l(Math.pow(M,6)),C=this,y="";;){var E=b(C,w).g;C=_(C,E.j(w));var L=((0<C.g.length?C.g[0]:C.h)>>>0).toString(M);if(C=E,v(C))return L+y;for(;6>L.length;)L="0"+L;y=L+y}},i.i=function(M){return 0>M?0:M<this.g.length?this.g[M]:this.h};function v(M){if(M.h!=0)return!1;for(var w=0;w<M.g.length;w++)if(M.g[w]!=0)return!1;return!0}function x(M){return M.h==-1}i.l=function(M){return M=_(this,M),x(M)?-1:v(M)?0:1};function m(M){for(var w=M.g.length,C=[],y=0;y<w;y++)C[y]=~M.g[y];return new o(C,~M.h).add(f)}i.abs=function(){return x(this)?m(this):this},i.add=function(M){for(var w=Math.max(this.g.length,M.g.length),C=[],y=0,E=0;E<=w;E++){var L=y+(this.i(E)&65535)+(M.i(E)&65535),R=(L>>>16)+(this.i(E)>>>16)+(M.i(E)>>>16);y=R>>>16,L&=65535,R&=65535,C[E]=R<<16|L}return new o(C,C[C.length-1]&-2147483648?-1:0)};function _(M,w){return M.add(m(w))}i.j=function(M){if(v(this)||v(M))return d;if(x(this))return x(M)?m(this).j(m(M)):m(m(this).j(M));if(x(M))return m(this.j(m(M)));if(0>this.l(p)&&0>M.l(p))return l(this.m()*M.m());for(var w=this.g.length+M.g.length,C=[],y=0;y<2*w;y++)C[y]=0;for(y=0;y<this.g.length;y++)for(var E=0;E<M.g.length;E++){var L=this.i(y)>>>16,R=this.i(y)&65535,q=M.i(E)>>>16,nt=M.i(E)&65535;C[2*y+2*E]+=R*nt,A(C,2*y+2*E),C[2*y+2*E+1]+=L*nt,A(C,2*y+2*E+1),C[2*y+2*E+1]+=R*q,A(C,2*y+2*E+1),C[2*y+2*E+2]+=L*q,A(C,2*y+2*E+2)}for(y=0;y<w;y++)C[y]=C[2*y+1]<<16|C[2*y];for(y=w;y<2*w;y++)C[y]=0;return new o(C,0)};function A(M,w){for(;(M[w]&65535)!=M[w];)M[w+1]+=M[w]>>>16,M[w]&=65535,w++}function S(M,w){this.g=M,this.h=w}function b(M,w){if(v(w))throw Error("division by zero");if(v(M))return new S(d,d);if(x(M))return w=b(m(M),w),new S(m(w.g),m(w.h));if(x(w))return w=b(M,m(w)),new S(m(w.g),w.h);if(30<M.g.length){if(x(M)||x(w))throw Error("slowDivide_ only works with positive integers.");for(var C=f,y=w;0>=y.l(M);)C=F(C),y=F(y);var E=N(C,1),L=N(y,1);for(y=N(y,2),C=N(C,2);!v(y);){var R=L.add(y);0>=R.l(M)&&(E=E.add(C),L=R),y=N(y,1),C=N(C,1)}return w=_(M,E.j(w)),new S(E,w)}for(E=d;0<=M.l(w);){for(C=Math.max(1,Math.floor(M.m()/w.m())),y=Math.ceil(Math.log(C)/Math.LN2),y=48>=y?1:Math.pow(2,y-48),L=l(C),R=L.j(w);x(R)||0<R.l(M);)C-=y,L=l(C),R=L.j(w);v(L)&&(L=f),E=E.add(L),M=_(M,R)}return new S(E,M)}i.A=function(M){return b(this,M).h},i.and=function(M){for(var w=Math.max(this.g.length,M.g.length),C=[],y=0;y<w;y++)C[y]=this.i(y)&M.i(y);return new o(C,this.h&M.h)},i.or=function(M){for(var w=Math.max(this.g.length,M.g.length),C=[],y=0;y<w;y++)C[y]=this.i(y)|M.i(y);return new o(C,this.h|M.h)},i.xor=function(M){for(var w=Math.max(this.g.length,M.g.length),C=[],y=0;y<w;y++)C[y]=this.i(y)^M.i(y);return new o(C,this.h^M.h)};function F(M){for(var w=M.g.length+1,C=[],y=0;y<w;y++)C[y]=M.i(y)<<1|M.i(y-1)>>>31;return new o(C,M.h)}function N(M,w){var C=w>>5;w%=32;for(var y=M.g.length-C,E=[],L=0;L<y;L++)E[L]=0<w?M.i(L+C)>>>w|M.i(L+C+1)<<32-w:M.i(L+C);return new o(E,M.h)}n.prototype.digest=n.prototype.v,n.prototype.reset=n.prototype.s,n.prototype.update=n.prototype.u,x0=n,o.prototype.add=o.prototype.add,o.prototype.multiply=o.prototype.j,o.prototype.modulo=o.prototype.A,o.prototype.compare=o.prototype.l,o.prototype.toNumber=o.prototype.m,o.prototype.toString=o.prototype.toString,o.prototype.getBits=o.prototype.i,o.fromNumber=l,o.fromString=h,fs=o}).apply(typeof Ym<"u"?Ym:typeof self<"u"?self:typeof window<"u"?window:{});var Ic=typeof globalThis<"u"?globalThis:typeof window<"u"?window:typeof global<"u"?global:typeof self<"u"?self:{};/** @license
Copyright The Closure Library Authors.
SPDX-License-Identifier: Apache-2.0
*/var E0,jo,T0,Wc,Zh,S0,A0,M0;(function(){var i,t=typeof Object.defineProperties=="function"?Object.defineProperty:function(u,g,T){return u==Array.prototype||u==Object.prototype||(u[g]=T.value),u};function e(u){u=[typeof globalThis=="object"&&globalThis,u,typeof window=="object"&&window,typeof self=="object"&&self,typeof Ic=="object"&&Ic];for(var g=0;g<u.length;++g){var T=u[g];if(T&&T.Math==Math)return T}throw Error("Cannot find global object")}var n=e(this);function s(u,g){if(g)t:{var T=n;u=u.split(".");for(var D=0;D<u.length-1;D++){var H=u[D];if(!(H in T))break t;T=T[H]}u=u[u.length-1],D=T[u],g=g(D),g!=D&&g!=null&&t(T,u,{configurable:!0,writable:!0,value:g})}}function r(u,g){u instanceof String&&(u+="");var T=0,D=!1,H={next:function(){if(!D&&T<u.length){var K=T++;return{value:g(K,u[K]),done:!1}}return D=!0,{done:!0,value:void 0}}};return H[Symbol.iterator]=function(){return H},H}s("Array.prototype.values",function(u){return u||function(){return r(this,function(g,T){return T})}});/** @license

 Copyright The Closure Library Authors.
 SPDX-License-Identifier: Apache-2.0
*/var o=o||{},a=this||self;function c(u){var g=typeof u;return g=g!="object"?g:u?Array.isArray(u)?"array":g:"null",g=="array"||g=="object"&&typeof u.length=="number"}function l(u){var g=typeof u;return g=="object"&&u!=null||g=="function"}function h(u,g,T){return u.call.apply(u.bind,arguments)}function d(u,g,T){if(!u)throw Error();if(2<arguments.length){var D=Array.prototype.slice.call(arguments,2);return function(){var H=Array.prototype.slice.call(arguments);return Array.prototype.unshift.apply(H,D),u.apply(g,H)}}return function(){return u.apply(g,arguments)}}function f(u,g,T){return f=Function.prototype.bind&&Function.prototype.bind.toString().indexOf("native code")!=-1?h:d,f.apply(null,arguments)}function p(u,g){var T=Array.prototype.slice.call(arguments,1);return function(){var D=T.slice();return D.push.apply(D,arguments),u.apply(this,D)}}function v(u,g){function T(){}T.prototype=g.prototype,u.aa=g.prototype,u.prototype=new T,u.prototype.constructor=u,u.Qb=function(D,H,K){for(var ut=Array(arguments.length-2),Ae=2;Ae<arguments.length;Ae++)ut[Ae-2]=arguments[Ae];return g.prototype[H].apply(D,ut)}}function x(u){const g=u.length;if(0<g){const T=Array(g);for(let D=0;D<g;D++)T[D]=u[D];return T}return[]}function m(u,g){for(let T=1;T<arguments.length;T++){const D=arguments[T];if(c(D)){const H=u.length||0,K=D.length||0;u.length=H+K;for(let ut=0;ut<K;ut++)u[H+ut]=D[ut]}else u.push(D)}}class _{constructor(g,T){this.i=g,this.j=T,this.h=0,this.g=null}get(){let g;return 0<this.h?(this.h--,g=this.g,this.g=g.next,g.next=null):g=this.i(),g}}function A(u){return/^[\s\xa0]*$/.test(u)}function S(){var u=a.navigator;return u&&(u=u.userAgent)?u:""}function b(u){return b[" "](u),u}b[" "]=function(){};var F=S().indexOf("Gecko")!=-1&&!(S().toLowerCase().indexOf("webkit")!=-1&&S().indexOf("Edge")==-1)&&!(S().indexOf("Trident")!=-1||S().indexOf("MSIE")!=-1)&&S().indexOf("Edge")==-1;function N(u,g,T){for(const D in u)g.call(T,u[D],D,u)}function M(u,g){for(const T in u)g.call(void 0,u[T],T,u)}function w(u){const g={};for(const T in u)g[T]=u[T];return g}const C="constructor hasOwnProperty isPrototypeOf propertyIsEnumerable toLocaleString toString valueOf".split(" ");function y(u,g){let T,D;for(let H=1;H<arguments.length;H++){D=arguments[H];for(T in D)u[T]=D[T];for(let K=0;K<C.length;K++)T=C[K],Object.prototype.hasOwnProperty.call(D,T)&&(u[T]=D[T])}}function E(u){var g=1;u=u.split(":");const T=[];for(;0<g&&u.length;)T.push(u.shift()),g--;return u.length&&T.push(u.join(":")),T}function L(u){a.setTimeout(()=>{throw u},0)}function R(){var u=Et;let g=null;return u.g&&(g=u.g,u.g=u.g.next,u.g||(u.h=null),g.next=null),g}class q{constructor(){this.h=this.g=null}add(g,T){const D=nt.get();D.set(g,T),this.h?this.h.next=D:this.g=D,this.h=D}}var nt=new _(()=>new j,u=>u.reset());class j{constructor(){this.next=this.g=this.h=null}set(g,T){this.h=g,this.g=T,this.next=null}reset(){this.next=this.g=this.h=null}}let ot,Y=!1,Et=new q,Tt=()=>{const u=a.Promise.resolve(void 0);ot=()=>{u.then(Ct)}};var Ct=()=>{for(var u;u=R();){try{u.h.call(u.g)}catch(T){L(T)}var g=nt;g.j(u),100>g.h&&(g.h++,u.next=g.g,g.g=u)}Y=!1};function $t(){this.s=this.s,this.C=this.C}$t.prototype.s=!1,$t.prototype.ma=function(){this.s||(this.s=!0,this.N())},$t.prototype.N=function(){if(this.C)for(;this.C.length;)this.C.shift()()};function Ht(u,g){this.type=u,this.g=this.target=g,this.defaultPrevented=!1}Ht.prototype.h=function(){this.defaultPrevented=!0};var J=function(){if(!a.addEventListener||!Object.defineProperty)return!1;var u=!1,g=Object.defineProperty({},"passive",{get:function(){u=!0}});try{const T=()=>{};a.addEventListener("test",T,g),a.removeEventListener("test",T,g)}catch{}return u}();function rt(u,g){if(Ht.call(this,u?u.type:""),this.relatedTarget=this.g=this.target=null,this.button=this.screenY=this.screenX=this.clientY=this.clientX=0,this.key="",this.metaKey=this.shiftKey=this.altKey=this.ctrlKey=!1,this.state=null,this.pointerId=0,this.pointerType="",this.i=null,u){var T=this.type=u.type,D=u.changedTouches&&u.changedTouches.length?u.changedTouches[0]:null;if(this.target=u.target||u.srcElement,this.g=g,g=u.relatedTarget){if(F){t:{try{b(g.nodeName);var H=!0;break t}catch{}H=!1}H||(g=null)}}else T=="mouseover"?g=u.fromElement:T=="mouseout"&&(g=u.toElement);this.relatedTarget=g,D?(this.clientX=D.clientX!==void 0?D.clientX:D.pageX,this.clientY=D.clientY!==void 0?D.clientY:D.pageY,this.screenX=D.screenX||0,this.screenY=D.screenY||0):(this.clientX=u.clientX!==void 0?u.clientX:u.pageX,this.clientY=u.clientY!==void 0?u.clientY:u.pageY,this.screenX=u.screenX||0,this.screenY=u.screenY||0),this.button=u.button,this.key=u.key||"",this.ctrlKey=u.ctrlKey,this.altKey=u.altKey,this.shiftKey=u.shiftKey,this.metaKey=u.metaKey,this.pointerId=u.pointerId||0,this.pointerType=typeof u.pointerType=="string"?u.pointerType:bt[u.pointerType]||"",this.state=u.state,this.i=u,u.defaultPrevented&&rt.aa.h.call(this)}}v(rt,Ht);var bt={2:"touch",3:"pen",4:"mouse"};rt.prototype.h=function(){rt.aa.h.call(this);var u=this.i;u.preventDefault?u.preventDefault():u.returnValue=!1};var vt="closure_listenable_"+(1e6*Math.random()|0),Xt=0;function Vt(u,g,T,D,H){this.listener=u,this.proxy=null,this.src=g,this.type=T,this.capture=!!D,this.ha=H,this.key=++Xt,this.da=this.fa=!1}function Qt(u){u.da=!0,u.listener=null,u.proxy=null,u.src=null,u.ha=null}function ue(u){this.src=u,this.g={},this.h=0}ue.prototype.add=function(u,g,T,D,H){var K=u.toString();u=this.g[K],u||(u=this.g[K]=[],this.h++);var ut=V(u,g,D,H);return-1<ut?(g=u[ut],T||(g.fa=!1)):(g=new Vt(g,this.src,K,!!D,H),g.fa=T,u.push(g)),g};function ne(u,g){var T=g.type;if(T in u.g){var D=u.g[T],H=Array.prototype.indexOf.call(D,g,void 0),K;(K=0<=H)&&Array.prototype.splice.call(D,H,1),K&&(Qt(g),u.g[T].length==0&&(delete u.g[T],u.h--))}}function V(u,g,T,D){for(var H=0;H<u.length;++H){var K=u[H];if(!K.da&&K.listener==g&&K.capture==!!T&&K.ha==D)return H}return-1}var cn="closure_lm_"+(1e6*Math.random()|0),te={};function re(u,g,T,D,H){if(Array.isArray(g)){for(var K=0;K<g.length;K++)re(u,g[K],T,D,H);return null}return T=Q(T),u&&u[vt]?u.K(g,T,l(D)?!!D.capture:!1,H):kt(u,g,T,!1,D,H)}function kt(u,g,T,D,H,K){if(!g)throw Error("Invalid event type");var ut=l(H)?!!H.capture:!!H,Ae=Z(u);if(Ae||(u[cn]=Ae=new ue(u)),T=Ae.add(g,T,D,ut,K),T.proxy)return T;if(D=Te(),T.proxy=D,D.src=u,D.listener=T,u.addEventListener)J||(H=ut),H===void 0&&(H=!1),u.addEventListener(g.toString(),D,H);else if(u.attachEvent)u.attachEvent(I(g.toString()),D);else if(u.addListener&&u.removeListener)u.addListener(D);else throw Error("addEventListener and attachEvent are unavailable.");return T}function Te(){function u(T){return g.call(u.src,u.listener,T)}const g=G;return u}function zt(u,g,T,D,H){if(Array.isArray(g))for(var K=0;K<g.length;K++)zt(u,g[K],T,D,H);else D=l(D)?!!D.capture:!!D,T=Q(T),u&&u[vt]?(u=u.i,g=String(g).toString(),g in u.g&&(K=u.g[g],T=V(K,T,D,H),-1<T&&(Qt(K[T]),Array.prototype.splice.call(K,T,1),K.length==0&&(delete u.g[g],u.h--)))):u&&(u=Z(u))&&(g=u.g[g.toString()],u=-1,g&&(u=V(g,T,D,H)),(T=-1<u?g[u]:null)&&U(T))}function U(u){if(typeof u!="number"&&u&&!u.da){var g=u.src;if(g&&g[vt])ne(g.i,u);else{var T=u.type,D=u.proxy;g.removeEventListener?g.removeEventListener(T,D,u.capture):g.detachEvent?g.detachEvent(I(T),D):g.addListener&&g.removeListener&&g.removeListener(D),(T=Z(g))?(ne(T,u),T.h==0&&(T.src=null,g[cn]=null)):Qt(u)}}}function I(u){return u in te?te[u]:te[u]="on"+u}function G(u,g){if(u.da)u=!0;else{g=new rt(g,this);var T=u.listener,D=u.ha||u.src;u.fa&&U(u),u=T.call(D,g)}return u}function Z(u){return u=u[cn],u instanceof ue?u:null}var st="__closure_events_fn_"+(1e9*Math.random()>>>0);function Q(u){return typeof u=="function"?u:(u[st]||(u[st]=function(g){return u.handleEvent(g)}),u[st])}function ft(){$t.call(this),this.i=new ue(this),this.M=this,this.F=null}v(ft,$t),ft.prototype[vt]=!0,ft.prototype.removeEventListener=function(u,g,T,D){zt(this,u,g,T,D)};function at(u,g){var T,D=u.F;if(D)for(T=[];D;D=D.F)T.push(D);if(u=u.M,D=g.type||g,typeof g=="string")g=new Ht(g,u);else if(g instanceof Ht)g.target=g.target||u;else{var H=g;g=new Ht(D,u),y(g,H)}if(H=!0,T)for(var K=T.length-1;0<=K;K--){var ut=g.g=T[K];H=yt(ut,D,!0,g)&&H}if(ut=g.g=u,H=yt(ut,D,!0,g)&&H,H=yt(ut,D,!1,g)&&H,T)for(K=0;K<T.length;K++)ut=g.g=T[K],H=yt(ut,D,!1,g)&&H}ft.prototype.N=function(){if(ft.aa.N.call(this),this.i){var u=this.i,g;for(g in u.g){for(var T=u.g[g],D=0;D<T.length;D++)Qt(T[D]);delete u.g[g],u.h--}}this.F=null},ft.prototype.K=function(u,g,T,D){return this.i.add(String(u),g,!1,T,D)},ft.prototype.L=function(u,g,T,D){return this.i.add(String(u),g,!0,T,D)};function yt(u,g,T,D){if(g=u.i.g[String(g)],!g)return!0;g=g.concat();for(var H=!0,K=0;K<g.length;++K){var ut=g[K];if(ut&&!ut.da&&ut.capture==T){var Ae=ut.listener,ln=ut.ha||ut.src;ut.fa&&ne(u.i,ut),H=Ae.call(ln,D)!==!1&&H}}return H&&!D.defaultPrevented}function oe(u,g,T){if(typeof u=="function")T&&(u=f(u,T));else if(u&&typeof u.handleEvent=="function")u=f(u.handleEvent,u);else throw Error("Invalid listener argument");return 2147483647<Number(g)?-1:a.setTimeout(u,g||0)}function ct(u){u.g=oe(()=>{u.g=null,u.i&&(u.i=!1,ct(u))},u.l);const g=u.h;u.h=null,u.m.apply(null,g)}class Mt extends $t{constructor(g,T){super(),this.m=g,this.l=T,this.h=null,this.i=!1,this.g=null}j(g){this.h=arguments,this.g?this.i=!0:ct(this)}N(){super.N(),this.g&&(a.clearTimeout(this.g),this.g=null,this.i=!1,this.h=null)}}function Ut(u){$t.call(this),this.h=u,this.g={}}v(Ut,$t);var Bt=[];function St(u){N(u.g,function(g,T){this.g.hasOwnProperty(T)&&U(g)},u),u.g={}}Ut.prototype.N=function(){Ut.aa.N.call(this),St(this)},Ut.prototype.handleEvent=function(){throw Error("EventHandler.handleEvent not implemented")};var ee=a.JSON.stringify,qt=a.JSON.parse,Ee=class{stringify(u){return a.JSON.stringify(u,void 0)}parse(u){return a.JSON.parse(u,void 0)}};function B(){}B.prototype.h=null;function _t(u){return u.h||(u.h=u.i())}function $(){}var et={OPEN:"a",kb:"b",Ja:"c",wb:"d"};function pt(){Ht.call(this,"d")}v(pt,Ht);function mt(){Ht.call(this,"c")}v(mt,Ht);var Kt={},Ne=null;function je(){return Ne=Ne||new ft}Kt.La="serverreachability";function ae(u){Ht.call(this,Kt.La,u)}v(ae,Ht);function ze(u){const g=je();at(g,new ae(g))}Kt.STAT_EVENT="statevent";function Vn(u,g){Ht.call(this,Kt.STAT_EVENT,u),this.stat=g}v(Vn,Ht);function nn(u){const g=je();at(g,new Vn(g,u))}Kt.Ma="timingevent";function yo(u,g){Ht.call(this,Kt.Ma,u),this.size=g}v(yo,Ht);function Ln(u,g){if(typeof u!="function")throw Error("Fn must not be null and must be a function");return a.setTimeout(function(){u()},g)}function bi(){this.g=!0}bi.prototype.xa=function(){this.g=!1};function Va(u,g,T,D,H,K){u.info(function(){if(u.g)if(K)for(var ut="",Ae=K.split("&"),ln=0;ln<Ae.length;ln++){var pe=Ae[ln].split("=");if(1<pe.length){var _n=pe[0];pe=pe[1];var vn=_n.split("_");ut=2<=vn.length&&vn[1]=="type"?ut+(_n+"="+pe+"&"):ut+(_n+"=redacted&")}}else ut=null;else ut=K;return"XMLHTTP REQ ("+D+") [attempt "+H+"]: "+g+`
`+T+`
`+ut})}function Ba(u,g,T,D,H,K,ut){u.info(function(){return"XMLHTTP RESP ("+D+") [ attempt "+H+"]: "+g+`
`+T+`
`+K+" "+ut})}function Kn(u,g,T,D){u.info(function(){return"XMLHTTP TEXT ("+g+"): "+sr(u,T)+(D?" "+D:"")})}function ka(u,g){u.info(function(){return"TIMEOUT: "+g})}bi.prototype.info=function(){};function sr(u,g){if(!u.g)return g;if(!g)return null;try{var T=JSON.parse(g);if(T){for(u=0;u<T.length;u++)if(Array.isArray(T[u])){var D=T[u];if(!(2>D.length)){var H=D[1];if(Array.isArray(H)&&!(1>H.length)){var K=H[0];if(K!="noop"&&K!="stop"&&K!="close")for(var ut=1;ut<H.length;ut++)H[ut]=""}}}}return ee(T)}catch{return g}}var ws={NO_ERROR:0,gb:1,tb:2,sb:3,nb:4,rb:5,ub:6,Ia:7,TIMEOUT:8,xb:9},xo={lb:"complete",Hb:"success",Ja:"error",Ia:"abort",zb:"ready",Ab:"readystatechange",TIMEOUT:"timeout",vb:"incrementaldata",yb:"progress",ob:"downloadprogress",Pb:"uploadprogress"},Eo;function rr(){}v(rr,B),rr.prototype.g=function(){return new XMLHttpRequest},rr.prototype.i=function(){return{}},Eo=new rr;function ci(u,g,T,D){this.j=u,this.i=g,this.l=T,this.R=D||1,this.U=new Ut(this),this.I=45e3,this.H=null,this.o=!1,this.m=this.A=this.v=this.L=this.F=this.S=this.B=null,this.D=[],this.g=null,this.C=0,this.s=this.u=null,this.X=-1,this.J=!1,this.O=0,this.M=null,this.W=this.K=this.T=this.P=!1,this.h=new P}function P(){this.i=null,this.g="",this.h=!1}var k={},W={};function X(u,g,T){u.L=1,u.v=za(Fe(g)),u.m=T,u.P=!0,z(u,null)}function z(u,g){u.F=Date.now(),At(u),u.A=Fe(u.v);var T=u.A,D=u.R;Array.isArray(D)||(D=[String(D)]),Cf(T.i,"t",D),u.C=0,T=u.j.J,u.h=new P,u.g=Kf(u.j,T?g:null,!u.m),0<u.O&&(u.M=new Mt(f(u.Y,u,u.g),u.O)),g=u.U,T=u.g,D=u.ca;var H="readystatechange";Array.isArray(H)||(H&&(Bt[0]=H.toString()),H=Bt);for(var K=0;K<H.length;K++){var ut=re(T,H[K],D||g.handleEvent,!1,g.h||g);if(!ut)break;g.g[ut.key]=ut}g=u.H?w(u.H):{},u.m?(u.u||(u.u="POST"),g["Content-Type"]="application/x-www-form-urlencoded",u.g.ea(u.A,u.u,u.m,g)):(u.u="GET",u.g.ea(u.A,u.u,null,g)),ze(),Va(u.i,u.u,u.A,u.l,u.R,u.m)}ci.prototype.ca=function(u){u=u.target;const g=this.M;g&&Ri(u)==3?g.j():this.Y(u)},ci.prototype.Y=function(u){try{if(u==this.g)t:{const vn=Ri(this.g);var g=this.g.Ba();const ur=this.g.Z();if(!(3>vn)&&(vn!=3||this.g&&(this.h.h||this.g.oa()||Ff(this.g)))){this.J||vn!=4||g==7||(g==8||0>=ur?ze(3):ze(2)),Ot(this);var T=this.g.Z();this.X=T;e:if(lt(this)){var D=Ff(this.g);u="";var H=D.length,K=Ri(this.g)==4;if(!this.h.i){if(typeof TextDecoder>"u"){wt(this),Nt(this);var ut="";break e}this.h.i=new a.TextDecoder}for(g=0;g<H;g++)this.h.h=!0,u+=this.h.i.decode(D[g],{stream:!(K&&g==H-1)});D.length=0,this.h.g+=u,this.C=0,ut=this.h.g}else ut=this.g.oa();if(this.o=T==200,Ba(this.i,this.u,this.A,this.l,this.R,vn,T),this.o){if(this.T&&!this.K){e:{if(this.g){var Ae,ln=this.g;if((Ae=ln.g?ln.g.getResponseHeader("X-HTTP-Initial-Response"):null)&&!A(Ae)){var pe=Ae;break e}}pe=null}if(T=pe)Kn(this.i,this.l,T,"Initial handshake response via X-HTTP-Initial-Response"),this.K=!0,he(this,T);else{this.o=!1,this.s=3,nn(12),wt(this),Nt(this);break t}}if(this.P){T=!0;let Yn;for(;!this.J&&this.C<ut.length;)if(Yn=gt(this,ut),Yn==W){vn==4&&(this.s=4,nn(14),T=!1),Kn(this.i,this.l,null,"[Incomplete Response]");break}else if(Yn==k){this.s=4,nn(15),Kn(this.i,this.l,ut,"[Invalid Chunk]"),T=!1;break}else Kn(this.i,this.l,Yn,null),he(this,Yn);if(lt(this)&&this.C!=0&&(this.h.g=this.h.g.slice(this.C),this.C=0),vn!=4||ut.length!=0||this.h.h||(this.s=1,nn(16),T=!1),this.o=this.o&&T,!T)Kn(this.i,this.l,ut,"[Invalid Chunked Response]"),wt(this),Nt(this);else if(0<ut.length&&!this.W){this.W=!0;var _n=this.j;_n.g==this&&_n.ba&&!_n.M&&(_n.j.info("Great, no buffering proxy detected. Bytes received: "+ut.length),Kl(_n),_n.M=!0,nn(11))}}else Kn(this.i,this.l,ut,null),he(this,ut);vn==4&&wt(this),this.o&&!this.J&&(vn==4?Wf(this.j,this):(this.o=!1,At(this)))}else uy(this.g),T==400&&0<ut.indexOf("Unknown SID")?(this.s=3,nn(12)):(this.s=0,nn(13)),wt(this),Nt(this)}}}catch{}finally{}};function lt(u){return u.g?u.u=="GET"&&u.L!=2&&u.j.Ca:!1}function gt(u,g){var T=u.C,D=g.indexOf(`
`,T);return D==-1?W:(T=Number(g.substring(T,D)),isNaN(T)?k:(D+=1,D+T>g.length?W:(g=g.slice(D,D+T),u.C=D+T,g)))}ci.prototype.cancel=function(){this.J=!0,wt(this)};function At(u){u.S=Date.now()+u.I,Rt(u,u.I)}function Rt(u,g){if(u.B!=null)throw Error("WatchDog timer not null");u.B=Ln(f(u.ba,u),g)}function Ot(u){u.B&&(a.clearTimeout(u.B),u.B=null)}ci.prototype.ba=function(){this.B=null;const u=Date.now();0<=u-this.S?(ka(this.i,this.A),this.L!=2&&(ze(),nn(17)),wt(this),this.s=2,Nt(this)):Rt(this,this.S-u)};function Nt(u){u.j.G==0||u.J||Wf(u.j,u)}function wt(u){Ot(u);var g=u.M;g&&typeof g.ma=="function"&&g.ma(),u.M=null,St(u.U),u.g&&(g=u.g,u.g=null,g.abort(),g.ma())}function he(u,g){try{var T=u.j;if(T.G!=0&&(T.g==u||Pt(T.h,u))){if(!u.K&&Pt(T.h,u)&&T.G==3){try{var D=T.Da.g.parse(g)}catch{D=null}if(Array.isArray(D)&&D.length==3){var H=D;if(H[0]==0){t:if(!T.u){if(T.g)if(T.g.F+3e3<u.F)ja(T),Xa(T);else break t;jl(T),nn(18)}}else T.za=H[1],0<T.za-T.T&&37500>H[2]&&T.F&&T.v==0&&!T.C&&(T.C=Ln(f(T.Za,T),6e3));if(1>=de(T.h)&&T.ca){try{T.ca()}catch{}T.ca=void 0}}else bs(T,11)}else if((u.K||T.g==u)&&ja(T),!A(g))for(H=T.Da.g.parse(g),g=0;g<H.length;g++){let pe=H[g];if(T.T=pe[0],pe=pe[1],T.G==2)if(pe[0]=="c"){T.K=pe[1],T.ia=pe[2];const _n=pe[3];_n!=null&&(T.la=_n,T.j.info("VER="+T.la));const vn=pe[4];vn!=null&&(T.Aa=vn,T.j.info("SVER="+T.Aa));const ur=pe[5];ur!=null&&typeof ur=="number"&&0<ur&&(D=1.5*ur,T.L=D,T.j.info("backChannelRequestTimeoutMs_="+D)),D=T;const Yn=u.g;if(Yn){const $a=Yn.g?Yn.g.getResponseHeader("X-Client-Wire-Protocol"):null;if($a){var K=D.h;K.g||$a.indexOf("spdy")==-1&&$a.indexOf("quic")==-1&&$a.indexOf("h2")==-1||(K.j=K.l,K.g=new Set,K.h&&(Be(K,K.h),K.h=null))}if(D.D){const $l=Yn.g?Yn.g.getResponseHeader("X-HTTP-Session-Id"):null;$l&&(D.ya=$l,Re(D.I,D.D,$l))}}T.G=3,T.l&&T.l.ua(),T.ba&&(T.R=Date.now()-u.F,T.j.info("Handshake RTT: "+T.R+"ms")),D=T;var ut=u;if(D.qa=jf(D,D.J?D.ia:null,D.W),ut.K){fe(D.h,ut);var Ae=ut,ln=D.L;ln&&(Ae.I=ln),Ae.B&&(Ot(Ae),At(Ae)),D.g=ut}else Hf(D);0<T.i.length&&qa(T)}else pe[0]!="stop"&&pe[0]!="close"||bs(T,7);else T.G==3&&(pe[0]=="stop"||pe[0]=="close"?pe[0]=="stop"?bs(T,7):ql(T):pe[0]!="noop"&&T.l&&T.l.ta(pe),T.v=0)}}ze(4)}catch{}}var Se=class{constructor(u,g){this.g=u,this.map=g}};function be(u){this.l=u||10,a.PerformanceNavigationTiming?(u=a.performance.getEntriesByType("navigation"),u=0<u.length&&(u[0].nextHopProtocol=="hq"||u[0].nextHopProtocol=="h2")):u=!!(a.chrome&&a.chrome.loadTimes&&a.chrome.loadTimes()&&a.chrome.loadTimes().wasFetchedViaSpdy),this.j=u?this.l:1,this.g=null,1<this.j&&(this.g=new Set),this.h=null,this.i=[]}function gn(u){return u.h?!0:u.g?u.g.size>=u.j:!1}function de(u){return u.h?1:u.g?u.g.size:0}function Pt(u,g){return u.h?u.h==g:u.g?u.g.has(g):!1}function Be(u,g){u.g?u.g.add(g):u.h=g}function fe(u,g){u.h&&u.h==g?u.h=null:u.g&&u.g.has(g)&&u.g.delete(g)}be.prototype.cancel=function(){if(this.i=In(this),this.h)this.h.cancel(),this.h=null;else if(this.g&&this.g.size!==0){for(const u of this.g.values())u.cancel();this.g.clear()}};function In(u){if(u.h!=null)return u.i.concat(u.h.D);if(u.g!=null&&u.g.size!==0){let g=u.i;for(const T of u.g.values())g=g.concat(T.D);return g}return x(u.i)}function Wi(u){if(u.V&&typeof u.V=="function")return u.V();if(typeof Map<"u"&&u instanceof Map||typeof Set<"u"&&u instanceof Set)return Array.from(u.values());if(typeof u=="string")return u.split("");if(c(u)){for(var g=[],T=u.length,D=0;D<T;D++)g.push(u[D]);return g}g=[],T=0;for(D in u)g[T++]=u[D];return g}function Mn(u){if(u.na&&typeof u.na=="function")return u.na();if(!u.V||typeof u.V!="function"){if(typeof Map<"u"&&u instanceof Map)return Array.from(u.keys());if(!(typeof Set<"u"&&u instanceof Set)){if(c(u)||typeof u=="string"){var g=[];u=u.length;for(var T=0;T<u;T++)g.push(T);return g}g=[],T=0;for(const D in u)g[T++]=D;return g}}}function or(u,g){if(u.forEach&&typeof u.forEach=="function")u.forEach(g,void 0);else if(c(u)||typeof u=="string")Array.prototype.forEach.call(u,g,void 0);else for(var T=Mn(u),D=Wi(u),H=D.length,K=0;K<H;K++)g.call(void 0,D[K],T&&T[K],u)}var Le=RegExp("^(?:([^:/?#.]+):)?(?://(?:([^\\\\/?#]*)@)?([^\\\\/?#]*?)(?::([0-9]+))?(?=[\\\\/?#]|$))?([^?#]+)?(?:\\?([^#]*))?(?:#([\\s\\S]*))?$");function li(u,g){if(u){u=u.split("&");for(var T=0;T<u.length;T++){var D=u[T].indexOf("="),H=null;if(0<=D){var K=u[T].substring(0,D);H=u[T].substring(D+1)}else K=u[T];g(K,H?decodeURIComponent(H.replace(/\+/g," ")):"")}}}function $n(u){if(this.g=this.o=this.j="",this.s=null,this.m=this.l="",this.h=!1,u instanceof $n){this.h=u.h,Xi(this,u.j),this.o=u.o,this.g=u.g,ar(this,u.s),this.l=u.l;var g=u.i,T=new Mo;T.i=g.i,g.g&&(T.g=new Map(g.g),T.h=g.h),To(this,T),this.m=u.m}else u&&(g=String(u).match(Le))?(this.h=!1,Xi(this,g[1]||"",!0),this.o=So(g[2]||""),this.g=So(g[3]||"",!0),ar(this,g[4]),this.l=So(g[5]||"",!0),To(this,g[6]||"",!0),this.m=So(g[7]||"")):(this.h=!1,this.i=new Mo(null,this.h))}$n.prototype.toString=function(){var u=[],g=this.j;g&&u.push(Ao(g,bf,!0),":");var T=this.g;return(T||g=="file")&&(u.push("//"),(g=this.o)&&u.push(Ao(g,bf,!0),"@"),u.push(encodeURIComponent(String(T)).replace(/%25([0-9a-fA-F]{2})/g,"%$1")),T=this.s,T!=null&&u.push(":",String(T))),(T=this.l)&&(this.g&&T.charAt(0)!="/"&&u.push("/"),u.push(Ao(T,T.charAt(0)=="/"?ty:Qv,!0))),(T=this.i.toString())&&u.push("?",T),(T=this.m)&&u.push("#",Ao(T,ny)),u.join("")};function Fe(u){return new $n(u)}function Xi(u,g,T){u.j=T?So(g,!0):g,u.j&&(u.j=u.j.replace(/:$/,""))}function ar(u,g){if(g){if(g=Number(g),isNaN(g)||0>g)throw Error("Bad port number "+g);u.s=g}else u.s=null}function To(u,g,T){g instanceof Mo?(u.i=g,iy(u.i,u.h)):(T||(g=Ao(g,ey)),u.i=new Mo(g,u.h))}function Re(u,g,T){u.i.set(g,T)}function za(u){return Re(u,"zx",Math.floor(2147483648*Math.random()).toString(36)+Math.abs(Math.floor(2147483648*Math.random())^Date.now()).toString(36)),u}function So(u,g){return u?g?decodeURI(u.replace(/%25/g,"%2525")):decodeURIComponent(u):""}function Ao(u,g,T){return typeof u=="string"?(u=encodeURI(u).replace(g,Zv),T&&(u=u.replace(/%25([0-9a-fA-F]{2})/g,"%$1")),u):null}function Zv(u){return u=u.charCodeAt(0),"%"+(u>>4&15).toString(16)+(u&15).toString(16)}var bf=/[#\/\?@]/g,Qv=/[#\?:]/g,ty=/[#\?]/g,ey=/[#\?@]/g,ny=/#/g;function Mo(u,g){this.h=this.g=null,this.i=u||null,this.j=!!g}function qi(u){u.g||(u.g=new Map,u.h=0,u.i&&li(u.i,function(g,T){u.add(decodeURIComponent(g.replace(/\+/g," ")),T)}))}i=Mo.prototype,i.add=function(u,g){qi(this),this.i=null,u=cr(this,u);var T=this.g.get(u);return T||this.g.set(u,T=[]),T.push(g),this.h+=1,this};function Rf(u,g){qi(u),g=cr(u,g),u.g.has(g)&&(u.i=null,u.h-=u.g.get(g).length,u.g.delete(g))}function If(u,g){return qi(u),g=cr(u,g),u.g.has(g)}i.forEach=function(u,g){qi(this),this.g.forEach(function(T,D){T.forEach(function(H){u.call(g,H,D,this)},this)},this)},i.na=function(){qi(this);const u=Array.from(this.g.values()),g=Array.from(this.g.keys()),T=[];for(let D=0;D<g.length;D++){const H=u[D];for(let K=0;K<H.length;K++)T.push(g[D])}return T},i.V=function(u){qi(this);let g=[];if(typeof u=="string")If(this,u)&&(g=g.concat(this.g.get(cr(this,u))));else{u=Array.from(this.g.values());for(let T=0;T<u.length;T++)g=g.concat(u[T])}return g},i.set=function(u,g){return qi(this),this.i=null,u=cr(this,u),If(this,u)&&(this.h-=this.g.get(u).length),this.g.set(u,[g]),this.h+=1,this},i.get=function(u,g){return u?(u=this.V(u),0<u.length?String(u[0]):g):g};function Cf(u,g,T){Rf(u,g),0<T.length&&(u.i=null,u.g.set(cr(u,g),x(T)),u.h+=T.length)}i.toString=function(){if(this.i)return this.i;if(!this.g)return"";const u=[],g=Array.from(this.g.keys());for(var T=0;T<g.length;T++){var D=g[T];const K=encodeURIComponent(String(D)),ut=this.V(D);for(D=0;D<ut.length;D++){var H=K;ut[D]!==""&&(H+="="+encodeURIComponent(String(ut[D]))),u.push(H)}}return this.i=u.join("&")};function cr(u,g){return g=String(g),u.j&&(g=g.toLowerCase()),g}function iy(u,g){g&&!u.j&&(qi(u),u.i=null,u.g.forEach(function(T,D){var H=D.toLowerCase();D!=H&&(Rf(this,D),Cf(this,H,T))},u)),u.j=g}function sy(u,g){const T=new bi;if(a.Image){const D=new Image;D.onload=p(ji,T,"TestLoadImage: loaded",!0,g,D),D.onerror=p(ji,T,"TestLoadImage: error",!1,g,D),D.onabort=p(ji,T,"TestLoadImage: abort",!1,g,D),D.ontimeout=p(ji,T,"TestLoadImage: timeout",!1,g,D),a.setTimeout(function(){D.ontimeout&&D.ontimeout()},1e4),D.src=u}else g(!1)}function ry(u,g){const T=new bi,D=new AbortController,H=setTimeout(()=>{D.abort(),ji(T,"TestPingServer: timeout",!1,g)},1e4);fetch(u,{signal:D.signal}).then(K=>{clearTimeout(H),K.ok?ji(T,"TestPingServer: ok",!0,g):ji(T,"TestPingServer: server error",!1,g)}).catch(()=>{clearTimeout(H),ji(T,"TestPingServer: error",!1,g)})}function ji(u,g,T,D,H){try{H&&(H.onload=null,H.onerror=null,H.onabort=null,H.ontimeout=null),D(T)}catch{}}function oy(){this.g=new Ee}function ay(u,g,T){const D=T||"";try{or(u,function(H,K){let ut=H;l(H)&&(ut=ee(H)),g.push(D+K+"="+encodeURIComponent(ut))})}catch(H){throw g.push(D+"type="+encodeURIComponent("_badmap")),H}}function Ha(u){this.l=u.Ub||null,this.j=u.eb||!1}v(Ha,B),Ha.prototype.g=function(){return new Ga(this.l,this.j)},Ha.prototype.i=function(u){return function(){return u}}({});function Ga(u,g){ft.call(this),this.D=u,this.o=g,this.m=void 0,this.status=this.readyState=0,this.responseType=this.responseText=this.response=this.statusText="",this.onreadystatechange=null,this.u=new Headers,this.h=null,this.B="GET",this.A="",this.g=!1,this.v=this.j=this.l=null}v(Ga,ft),i=Ga.prototype,i.open=function(u,g){if(this.readyState!=0)throw this.abort(),Error("Error reopening a connection");this.B=u,this.A=g,this.readyState=1,bo(this)},i.send=function(u){if(this.readyState!=1)throw this.abort(),Error("need to call open() first. ");this.g=!0;const g={headers:this.u,method:this.B,credentials:this.m,cache:void 0};u&&(g.body=u),(this.D||a).fetch(new Request(this.A,g)).then(this.Sa.bind(this),this.ga.bind(this))},i.abort=function(){this.response=this.responseText="",this.u=new Headers,this.status=0,this.j&&this.j.cancel("Request was aborted.").catch(()=>{}),1<=this.readyState&&this.g&&this.readyState!=4&&(this.g=!1,wo(this)),this.readyState=0},i.Sa=function(u){if(this.g&&(this.l=u,this.h||(this.status=this.l.status,this.statusText=this.l.statusText,this.h=u.headers,this.readyState=2,bo(this)),this.g&&(this.readyState=3,bo(this),this.g)))if(this.responseType==="arraybuffer")u.arrayBuffer().then(this.Qa.bind(this),this.ga.bind(this));else if(typeof a.ReadableStream<"u"&&"body"in u){if(this.j=u.body.getReader(),this.o){if(this.responseType)throw Error('responseType must be empty for "streamBinaryChunks" mode responses.');this.response=[]}else this.response=this.responseText="",this.v=new TextDecoder;Pf(this)}else u.text().then(this.Ra.bind(this),this.ga.bind(this))};function Pf(u){u.j.read().then(u.Pa.bind(u)).catch(u.ga.bind(u))}i.Pa=function(u){if(this.g){if(this.o&&u.value)this.response.push(u.value);else if(!this.o){var g=u.value?u.value:new Uint8Array(0);(g=this.v.decode(g,{stream:!u.done}))&&(this.response=this.responseText+=g)}u.done?wo(this):bo(this),this.readyState==3&&Pf(this)}},i.Ra=function(u){this.g&&(this.response=this.responseText=u,wo(this))},i.Qa=function(u){this.g&&(this.response=u,wo(this))},i.ga=function(){this.g&&wo(this)};function wo(u){u.readyState=4,u.l=null,u.j=null,u.v=null,bo(u)}i.setRequestHeader=function(u,g){this.u.append(u,g)},i.getResponseHeader=function(u){return this.h&&this.h.get(u.toLowerCase())||""},i.getAllResponseHeaders=function(){if(!this.h)return"";const u=[],g=this.h.entries();for(var T=g.next();!T.done;)T=T.value,u.push(T[0]+": "+T[1]),T=g.next();return u.join(`\r
`)};function bo(u){u.onreadystatechange&&u.onreadystatechange.call(u)}Object.defineProperty(Ga.prototype,"withCredentials",{get:function(){return this.m==="include"},set:function(u){this.m=u?"include":"same-origin"}});function Df(u){let g="";return N(u,function(T,D){g+=D,g+=":",g+=T,g+=`\r
`}),g}function Xl(u,g,T){t:{for(D in T){var D=!1;break t}D=!0}D||(T=Df(T),typeof u=="string"?T!=null&&encodeURIComponent(String(T)):Re(u,g,T))}function Ve(u){ft.call(this),this.headers=new Map,this.o=u||null,this.h=!1,this.v=this.g=null,this.D="",this.m=0,this.l="",this.j=this.B=this.u=this.A=!1,this.I=null,this.H="",this.J=!1}v(Ve,ft);var cy=/^https?$/i,ly=["POST","PUT"];i=Ve.prototype,i.Ha=function(u){this.J=u},i.ea=function(u,g,T,D){if(this.g)throw Error("[goog.net.XhrIo] Object is active with another request="+this.D+"; newUri="+u);g=g?g.toUpperCase():"GET",this.D=u,this.l="",this.m=0,this.A=!1,this.h=!0,this.g=this.o?this.o.g():Eo.g(),this.v=this.o?_t(this.o):_t(Eo),this.g.onreadystatechange=f(this.Ea,this);try{this.B=!0,this.g.open(g,String(u),!0),this.B=!1}catch(K){Lf(this,K);return}if(u=T||"",T=new Map(this.headers),D)if(Object.getPrototypeOf(D)===Object.prototype)for(var H in D)T.set(H,D[H]);else if(typeof D.keys=="function"&&typeof D.get=="function")for(const K of D.keys())T.set(K,D.get(K));else throw Error("Unknown input type for opt_headers: "+String(D));D=Array.from(T.keys()).find(K=>K.toLowerCase()=="content-type"),H=a.FormData&&u instanceof a.FormData,!(0<=Array.prototype.indexOf.call(ly,g,void 0))||D||H||T.set("Content-Type","application/x-www-form-urlencoded;charset=utf-8");for(const[K,ut]of T)this.g.setRequestHeader(K,ut);this.H&&(this.g.responseType=this.H),"withCredentials"in this.g&&this.g.withCredentials!==this.J&&(this.g.withCredentials=this.J);try{Of(this),this.u=!0,this.g.send(u),this.u=!1}catch(K){Lf(this,K)}};function Lf(u,g){u.h=!1,u.g&&(u.j=!0,u.g.abort(),u.j=!1),u.l=g,u.m=5,Nf(u),Wa(u)}function Nf(u){u.A||(u.A=!0,at(u,"complete"),at(u,"error"))}i.abort=function(u){this.g&&this.h&&(this.h=!1,this.j=!0,this.g.abort(),this.j=!1,this.m=u||7,at(this,"complete"),at(this,"abort"),Wa(this))},i.N=function(){this.g&&(this.h&&(this.h=!1,this.j=!0,this.g.abort(),this.j=!1),Wa(this,!0)),Ve.aa.N.call(this)},i.Ea=function(){this.s||(this.B||this.u||this.j?Uf(this):this.bb())},i.bb=function(){Uf(this)};function Uf(u){if(u.h&&typeof o<"u"&&(!u.v[1]||Ri(u)!=4||u.Z()!=2)){if(u.u&&Ri(u)==4)oe(u.Ea,0,u);else if(at(u,"readystatechange"),Ri(u)==4){u.h=!1;try{const ut=u.Z();t:switch(ut){case 200:case 201:case 202:case 204:case 206:case 304:case 1223:var g=!0;break t;default:g=!1}var T;if(!(T=g)){var D;if(D=ut===0){var H=String(u.D).match(Le)[1]||null;!H&&a.self&&a.self.location&&(H=a.self.location.protocol.slice(0,-1)),D=!cy.test(H?H.toLowerCase():"")}T=D}if(T)at(u,"complete"),at(u,"success");else{u.m=6;try{var K=2<Ri(u)?u.g.statusText:""}catch{K=""}u.l=K+" ["+u.Z()+"]",Nf(u)}}finally{Wa(u)}}}}function Wa(u,g){if(u.g){Of(u);const T=u.g,D=u.v[0]?()=>{}:null;u.g=null,u.v=null,g||at(u,"ready");try{T.onreadystatechange=D}catch{}}}function Of(u){u.I&&(a.clearTimeout(u.I),u.I=null)}i.isActive=function(){return!!this.g};function Ri(u){return u.g?u.g.readyState:0}i.Z=function(){try{return 2<Ri(this)?this.g.status:-1}catch{return-1}},i.oa=function(){try{return this.g?this.g.responseText:""}catch{return""}},i.Oa=function(u){if(this.g){var g=this.g.responseText;return u&&g.indexOf(u)==0&&(g=g.substring(u.length)),qt(g)}};function Ff(u){try{if(!u.g)return null;if("response"in u.g)return u.g.response;switch(u.H){case"":case"text":return u.g.responseText;case"arraybuffer":if("mozResponseArrayBuffer"in u.g)return u.g.mozResponseArrayBuffer}return null}catch{return null}}function uy(u){const g={};u=(u.g&&2<=Ri(u)&&u.g.getAllResponseHeaders()||"").split(`\r
`);for(let D=0;D<u.length;D++){if(A(u[D]))continue;var T=E(u[D]);const H=T[0];if(T=T[1],typeof T!="string")continue;T=T.trim();const K=g[H]||[];g[H]=K,K.push(T)}M(g,function(D){return D.join(", ")})}i.Ba=function(){return this.m},i.Ka=function(){return typeof this.l=="string"?this.l:String(this.l)};function Ro(u,g,T){return T&&T.internalChannelParams&&T.internalChannelParams[u]||g}function Vf(u){this.Aa=0,this.i=[],this.j=new bi,this.ia=this.qa=this.I=this.W=this.g=this.ya=this.D=this.H=this.m=this.S=this.o=null,this.Ya=this.U=0,this.Va=Ro("failFast",!1,u),this.F=this.C=this.u=this.s=this.l=null,this.X=!0,this.za=this.T=-1,this.Y=this.v=this.B=0,this.Ta=Ro("baseRetryDelayMs",5e3,u),this.cb=Ro("retryDelaySeedMs",1e4,u),this.Wa=Ro("forwardChannelMaxRetries",2,u),this.wa=Ro("forwardChannelRequestTimeoutMs",2e4,u),this.pa=u&&u.xmlHttpFactory||void 0,this.Xa=u&&u.Tb||void 0,this.Ca=u&&u.useFetchStreams||!1,this.L=void 0,this.J=u&&u.supportsCrossDomainXhr||!1,this.K="",this.h=new be(u&&u.concurrentRequestLimit),this.Da=new oy,this.P=u&&u.fastHandshake||!1,this.O=u&&u.encodeInitMessageHeaders||!1,this.P&&this.O&&(this.O=!1),this.Ua=u&&u.Rb||!1,u&&u.xa&&this.j.xa(),u&&u.forceLongPolling&&(this.X=!1),this.ba=!this.P&&this.X&&u&&u.detectBufferingProxy||!1,this.ja=void 0,u&&u.longPollingTimeout&&0<u.longPollingTimeout&&(this.ja=u.longPollingTimeout),this.ca=void 0,this.R=0,this.M=!1,this.ka=this.A=null}i=Vf.prototype,i.la=8,i.G=1,i.connect=function(u,g,T,D){nn(0),this.W=u,this.H=g||{},T&&D!==void 0&&(this.H.OSID=T,this.H.OAID=D),this.F=this.X,this.I=jf(this,null,this.W),qa(this)};function ql(u){if(Bf(u),u.G==3){var g=u.U++,T=Fe(u.I);if(Re(T,"SID",u.K),Re(T,"RID",g),Re(T,"TYPE","terminate"),Io(u,T),g=new ci(u,u.j,g),g.L=2,g.v=za(Fe(T)),T=!1,a.navigator&&a.navigator.sendBeacon)try{T=a.navigator.sendBeacon(g.v.toString(),"")}catch{}!T&&a.Image&&(new Image().src=g.v,T=!0),T||(g.g=Kf(g.j,null),g.g.ea(g.v)),g.F=Date.now(),At(g)}qf(u)}function Xa(u){u.g&&(Kl(u),u.g.cancel(),u.g=null)}function Bf(u){Xa(u),u.u&&(a.clearTimeout(u.u),u.u=null),ja(u),u.h.cancel(),u.s&&(typeof u.s=="number"&&a.clearTimeout(u.s),u.s=null)}function qa(u){if(!gn(u.h)&&!u.s){u.s=!0;var g=u.Ga;ot||Tt(),Y||(ot(),Y=!0),Et.add(g,u),u.B=0}}function hy(u,g){return de(u.h)>=u.h.j-(u.s?1:0)?!1:u.s?(u.i=g.D.concat(u.i),!0):u.G==1||u.G==2||u.B>=(u.Va?0:u.Wa)?!1:(u.s=Ln(f(u.Ga,u,g),Xf(u,u.B)),u.B++,!0)}i.Ga=function(u){if(this.s)if(this.s=null,this.G==1){if(!u){this.U=Math.floor(1e5*Math.random()),u=this.U++;const H=new ci(this,this.j,u);let K=this.o;if(this.S&&(K?(K=w(K),y(K,this.S)):K=this.S),this.m!==null||this.O||(H.H=K,K=null),this.P)t:{for(var g=0,T=0;T<this.i.length;T++){e:{var D=this.i[T];if("__data__"in D.map&&(D=D.map.__data__,typeof D=="string")){D=D.length;break e}D=void 0}if(D===void 0)break;if(g+=D,4096<g){g=T;break t}if(g===4096||T===this.i.length-1){g=T+1;break t}}g=1e3}else g=1e3;g=zf(this,H,g),T=Fe(this.I),Re(T,"RID",u),Re(T,"CVER",22),this.D&&Re(T,"X-HTTP-Session-Id",this.D),Io(this,T),K&&(this.O?g="headers="+encodeURIComponent(String(Df(K)))+"&"+g:this.m&&Xl(T,this.m,K)),Be(this.h,H),this.Ua&&Re(T,"TYPE","init"),this.P?(Re(T,"$req",g),Re(T,"SID","null"),H.T=!0,X(H,T,null)):X(H,T,g),this.G=2}}else this.G==3&&(u?kf(this,u):this.i.length==0||gn(this.h)||kf(this))};function kf(u,g){var T;g?T=g.l:T=u.U++;const D=Fe(u.I);Re(D,"SID",u.K),Re(D,"RID",T),Re(D,"AID",u.T),Io(u,D),u.m&&u.o&&Xl(D,u.m,u.o),T=new ci(u,u.j,T,u.B+1),u.m===null&&(T.H=u.o),g&&(u.i=g.D.concat(u.i)),g=zf(u,T,1e3),T.I=Math.round(.5*u.wa)+Math.round(.5*u.wa*Math.random()),Be(u.h,T),X(T,D,g)}function Io(u,g){u.H&&N(u.H,function(T,D){Re(g,D,T)}),u.l&&or({},function(T,D){Re(g,D,T)})}function zf(u,g,T){T=Math.min(u.i.length,T);var D=u.l?f(u.l.Na,u.l,u):null;t:{var H=u.i;let K=-1;for(;;){const ut=["count="+T];K==-1?0<T?(K=H[0].g,ut.push("ofs="+K)):K=0:ut.push("ofs="+K);let Ae=!0;for(let ln=0;ln<T;ln++){let pe=H[ln].g;const _n=H[ln].map;if(pe-=K,0>pe)K=Math.max(0,H[ln].g-100),Ae=!1;else try{ay(_n,ut,"req"+pe+"_")}catch{D&&D(_n)}}if(Ae){D=ut.join("&");break t}}}return u=u.i.splice(0,T),g.D=u,D}function Hf(u){if(!u.g&&!u.u){u.Y=1;var g=u.Fa;ot||Tt(),Y||(ot(),Y=!0),Et.add(g,u),u.v=0}}function jl(u){return u.g||u.u||3<=u.v?!1:(u.Y++,u.u=Ln(f(u.Fa,u),Xf(u,u.v)),u.v++,!0)}i.Fa=function(){if(this.u=null,Gf(this),this.ba&&!(this.M||this.g==null||0>=this.R)){var u=2*this.R;this.j.info("BP detection timer enabled: "+u),this.A=Ln(f(this.ab,this),u)}},i.ab=function(){this.A&&(this.A=null,this.j.info("BP detection timeout reached."),this.j.info("Buffering proxy detected and switch to long-polling!"),this.F=!1,this.M=!0,nn(10),Xa(this),Gf(this))};function Kl(u){u.A!=null&&(a.clearTimeout(u.A),u.A=null)}function Gf(u){u.g=new ci(u,u.j,"rpc",u.Y),u.m===null&&(u.g.H=u.o),u.g.O=0;var g=Fe(u.qa);Re(g,"RID","rpc"),Re(g,"SID",u.K),Re(g,"AID",u.T),Re(g,"CI",u.F?"0":"1"),!u.F&&u.ja&&Re(g,"TO",u.ja),Re(g,"TYPE","xmlhttp"),Io(u,g),u.m&&u.o&&Xl(g,u.m,u.o),u.L&&(u.g.I=u.L);var T=u.g;u=u.ia,T.L=1,T.v=za(Fe(g)),T.m=null,T.P=!0,z(T,u)}i.Za=function(){this.C!=null&&(this.C=null,Xa(this),jl(this),nn(19))};function ja(u){u.C!=null&&(a.clearTimeout(u.C),u.C=null)}function Wf(u,g){var T=null;if(u.g==g){ja(u),Kl(u),u.g=null;var D=2}else if(Pt(u.h,g))T=g.D,fe(u.h,g),D=1;else return;if(u.G!=0){if(g.o)if(D==1){T=g.m?g.m.length:0,g=Date.now()-g.F;var H=u.B;D=je(),at(D,new yo(D,T)),qa(u)}else Hf(u);else if(H=g.s,H==3||H==0&&0<g.X||!(D==1&&hy(u,g)||D==2&&jl(u)))switch(T&&0<T.length&&(g=u.h,g.i=g.i.concat(T)),H){case 1:bs(u,5);break;case 4:bs(u,10);break;case 3:bs(u,6);break;default:bs(u,2)}}}function Xf(u,g){let T=u.Ta+Math.floor(Math.random()*u.cb);return u.isActive()||(T*=2),T*g}function bs(u,g){if(u.j.info("Error code "+g),g==2){var T=f(u.fb,u),D=u.Xa;const H=!D;D=new $n(D||"//www.google.com/images/cleardot.gif"),a.location&&a.location.protocol=="http"||Xi(D,"https"),za(D),H?sy(D.toString(),T):ry(D.toString(),T)}else nn(2);u.G=0,u.l&&u.l.sa(g),qf(u),Bf(u)}i.fb=function(u){u?(this.j.info("Successfully pinged google.com"),nn(2)):(this.j.info("Failed to ping google.com"),nn(1))};function qf(u){if(u.G=0,u.ka=[],u.l){const g=In(u.h);(g.length!=0||u.i.length!=0)&&(m(u.ka,g),m(u.ka,u.i),u.h.i.length=0,x(u.i),u.i.length=0),u.l.ra()}}function jf(u,g,T){var D=T instanceof $n?Fe(T):new $n(T);if(D.g!="")g&&(D.g=g+"."+D.g),ar(D,D.s);else{var H=a.location;D=H.protocol,g=g?g+"."+H.hostname:H.hostname,H=+H.port;var K=new $n(null);D&&Xi(K,D),g&&(K.g=g),H&&ar(K,H),T&&(K.l=T),D=K}return T=u.D,g=u.ya,T&&g&&Re(D,T,g),Re(D,"VER",u.la),Io(u,D),D}function Kf(u,g,T){if(g&&!u.J)throw Error("Can't create secondary domain capable XhrIo object.");return g=u.Ca&&!u.pa?new Ve(new Ha({eb:T})):new Ve(u.pa),g.Ha(u.J),g}i.isActive=function(){return!!this.l&&this.l.isActive(this)};function $f(){}i=$f.prototype,i.ua=function(){},i.ta=function(){},i.sa=function(){},i.ra=function(){},i.isActive=function(){return!0},i.Na=function(){};function Ka(){}Ka.prototype.g=function(u,g){return new Nn(u,g)};function Nn(u,g){ft.call(this),this.g=new Vf(g),this.l=u,this.h=g&&g.messageUrlParams||null,u=g&&g.messageHeaders||null,g&&g.clientProtocolHeaderRequired&&(u?u["X-Client-Protocol"]="webchannel":u={"X-Client-Protocol":"webchannel"}),this.g.o=u,u=g&&g.initMessageHeaders||null,g&&g.messageContentType&&(u?u["X-WebChannel-Content-Type"]=g.messageContentType:u={"X-WebChannel-Content-Type":g.messageContentType}),g&&g.va&&(u?u["X-WebChannel-Client-Profile"]=g.va:u={"X-WebChannel-Client-Profile":g.va}),this.g.S=u,(u=g&&g.Sb)&&!A(u)&&(this.g.m=u),this.v=g&&g.supportsCrossDomainXhr||!1,this.u=g&&g.sendRawJson||!1,(g=g&&g.httpSessionIdParam)&&!A(g)&&(this.g.D=g,u=this.h,u!==null&&g in u&&(u=this.h,g in u&&delete u[g])),this.j=new lr(this)}v(Nn,ft),Nn.prototype.m=function(){this.g.l=this.j,this.v&&(this.g.J=!0),this.g.connect(this.l,this.h||void 0)},Nn.prototype.close=function(){ql(this.g)},Nn.prototype.o=function(u){var g=this.g;if(typeof u=="string"){var T={};T.__data__=u,u=T}else this.u&&(T={},T.__data__=ee(u),u=T);g.i.push(new Se(g.Ya++,u)),g.G==3&&qa(g)},Nn.prototype.N=function(){this.g.l=null,delete this.j,ql(this.g),delete this.g,Nn.aa.N.call(this)};function Yf(u){pt.call(this),u.__headers__&&(this.headers=u.__headers__,this.statusCode=u.__status__,delete u.__headers__,delete u.__status__);var g=u.__sm__;if(g){t:{for(const T in g){u=T;break t}u=void 0}(this.i=u)&&(u=this.i,g=g!==null&&u in g?g[u]:void 0),this.data=g}else this.data=u}v(Yf,pt);function Jf(){mt.call(this),this.status=1}v(Jf,mt);function lr(u){this.g=u}v(lr,$f),lr.prototype.ua=function(){at(this.g,"a")},lr.prototype.ta=function(u){at(this.g,new Yf(u))},lr.prototype.sa=function(u){at(this.g,new Jf)},lr.prototype.ra=function(){at(this.g,"b")},Ka.prototype.createWebChannel=Ka.prototype.g,Nn.prototype.send=Nn.prototype.o,Nn.prototype.open=Nn.prototype.m,Nn.prototype.close=Nn.prototype.close,M0=function(){return new Ka},A0=function(){return je()},S0=Kt,Zh={mb:0,pb:1,qb:2,Jb:3,Ob:4,Lb:5,Mb:6,Kb:7,Ib:8,Nb:9,PROXY:10,NOPROXY:11,Gb:12,Cb:13,Db:14,Bb:15,Eb:16,Fb:17,ib:18,hb:19,jb:20},ws.NO_ERROR=0,ws.TIMEOUT=8,ws.HTTP_ERROR=6,Wc=ws,xo.COMPLETE="complete",T0=xo,$.EventType=et,et.OPEN="a",et.CLOSE="b",et.ERROR="c",et.MESSAGE="d",ft.prototype.listen=ft.prototype.K,jo=$,Ve.prototype.listenOnce=Ve.prototype.L,Ve.prototype.getLastError=Ve.prototype.Ka,Ve.prototype.getLastErrorCode=Ve.prototype.Ba,Ve.prototype.getStatus=Ve.prototype.Z,Ve.prototype.getResponseJson=Ve.prototype.Oa,Ve.prototype.getResponseText=Ve.prototype.oa,Ve.prototype.send=Ve.prototype.ea,Ve.prototype.setWithCredentials=Ve.prototype.Ha,E0=Ve}).apply(typeof Ic<"u"?Ic:typeof self<"u"?self:typeof window<"u"?window:{});const Jm="@firebase/firestore",Zm="4.8.0";/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Tn{constructor(t){this.uid=t}isAuthenticated(){return this.uid!=null}toKey(){return this.isAuthenticated()?"uid:"+this.uid:"anonymous-user"}isEqual(t){return t.uid===this.uid}}Tn.UNAUTHENTICATED=new Tn(null),Tn.GOOGLE_CREDENTIALS=new Tn("google-credentials-uid"),Tn.FIRST_PARTY=new Tn("first-party-uid"),Tn.MOCK_USER=new Tn("mock-user");/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */let mo="11.10.0";/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Zs=new p0("@firebase/firestore");function Pr(){return Zs.logLevel}function xt(i,...t){if(Zs.logLevel<=le.DEBUG){const e=t.map(Kd);Zs.debug(`Firestore (${mo}): ${i}`,...e)}}function Hi(i,...t){if(Zs.logLevel<=le.ERROR){const e=t.map(Kd);Zs.error(`Firestore (${mo}): ${i}`,...e)}}function vs(i,...t){if(Zs.logLevel<=le.WARN){const e=t.map(Kd);Zs.warn(`Firestore (${mo}): ${i}`,...e)}}function Kd(i){if(typeof i=="string")return i;try{/**
* @license
* Copyright 2020 Google LLC
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*   http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/return function(e){return JSON.stringify(e)}(i)}catch{return i}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Ft(i,t,e){let n="Unexpected state";typeof t=="string"?n=t:e=t,w0(i,n,e)}function w0(i,t,e){let n=`FIRESTORE (${mo}) INTERNAL ASSERTION FAILED: ${t} (ID: ${i.toString(16)})`;if(e!==void 0)try{n+=" CONTEXT: "+JSON.stringify(e)}catch{n+=" CONTEXT: "+e}throw Hi(n),new Error(n)}function ye(i,t,e,n){let s="Unexpected state";typeof e=="string"?s=e:n=e,i||w0(t,s,n)}function jt(i,t){return i}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const it={OK:"ok",CANCELLED:"cancelled",UNKNOWN:"unknown",INVALID_ARGUMENT:"invalid-argument",DEADLINE_EXCEEDED:"deadline-exceeded",NOT_FOUND:"not-found",ALREADY_EXISTS:"already-exists",PERMISSION_DENIED:"permission-denied",UNAUTHENTICATED:"unauthenticated",RESOURCE_EXHAUSTED:"resource-exhausted",FAILED_PRECONDITION:"failed-precondition",ABORTED:"aborted",OUT_OF_RANGE:"out-of-range",UNIMPLEMENTED:"unimplemented",INTERNAL:"internal",UNAVAILABLE:"unavailable",DATA_LOSS:"data-loss"};class Dt extends po{constructor(t,e){super(t,e),this.code=t,this.message=e,this.toString=()=>`${this.name}: [code=${this.code}]: ${this.message}`}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Xs{constructor(){this.promise=new Promise((t,e)=>{this.resolve=t,this.reject=e})}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class b0{constructor(t,e){this.user=e,this.type="OAuth",this.headers=new Map,this.headers.set("Authorization",`Bearer ${t}`)}}class cI{getToken(){return Promise.resolve(null)}invalidateToken(){}start(t,e){t.enqueueRetryable(()=>e(Tn.UNAUTHENTICATED))}shutdown(){}}class lI{constructor(t){this.token=t,this.changeListener=null}getToken(){return Promise.resolve(this.token)}invalidateToken(){}start(t,e){this.changeListener=e,t.enqueueRetryable(()=>e(this.token.user))}shutdown(){this.changeListener=null}}class uI{constructor(t){this.t=t,this.currentUser=Tn.UNAUTHENTICATED,this.i=0,this.forceRefresh=!1,this.auth=null}start(t,e){ye(this.o===void 0,42304);let n=this.i;const s=c=>this.i!==n?(n=this.i,e(c)):Promise.resolve();let r=new Xs;this.o=()=>{this.i++,this.currentUser=this.u(),r.resolve(),r=new Xs,t.enqueueRetryable(()=>s(this.currentUser))};const o=()=>{const c=r;t.enqueueRetryable(async()=>{await c.promise,await s(this.currentUser)})},a=c=>{xt("FirebaseAuthCredentialsProvider","Auth detected"),this.auth=c,this.o&&(this.auth.addAuthTokenListener(this.o),o())};this.t.onInit(c=>a(c)),setTimeout(()=>{if(!this.auth){const c=this.t.getImmediate({optional:!0});c?a(c):(xt("FirebaseAuthCredentialsProvider","Auth not yet detected"),r.resolve(),r=new Xs)}},0),o()}getToken(){const t=this.i,e=this.forceRefresh;return this.forceRefresh=!1,this.auth?this.auth.getToken(e).then(n=>this.i!==t?(xt("FirebaseAuthCredentialsProvider","getToken aborted due to token change."),this.getToken()):n?(ye(typeof n.accessToken=="string",31837,{l:n}),new b0(n.accessToken,this.currentUser)):null):Promise.resolve(null)}invalidateToken(){this.forceRefresh=!0}shutdown(){this.auth&&this.o&&this.auth.removeAuthTokenListener(this.o),this.o=void 0}u(){const t=this.auth&&this.auth.getUid();return ye(t===null||typeof t=="string",2055,{h:t}),new Tn(t)}}class hI{constructor(t,e,n){this.P=t,this.T=e,this.I=n,this.type="FirstParty",this.user=Tn.FIRST_PARTY,this.A=new Map}R(){return this.I?this.I():null}get headers(){this.A.set("X-Goog-AuthUser",this.P);const t=this.R();return t&&this.A.set("Authorization",t),this.T&&this.A.set("X-Goog-Iam-Authorization-Token",this.T),this.A}}class dI{constructor(t,e,n){this.P=t,this.T=e,this.I=n}getToken(){return Promise.resolve(new hI(this.P,this.T,this.I))}start(t,e){t.enqueueRetryable(()=>e(Tn.FIRST_PARTY))}shutdown(){}invalidateToken(){}}class Qm{constructor(t){this.value=t,this.type="AppCheck",this.headers=new Map,t&&t.length>0&&this.headers.set("x-firebase-appcheck",this.value)}}class fI{constructor(t,e){this.V=e,this.forceRefresh=!1,this.appCheck=null,this.m=null,this.p=null,jR(t)&&t.settings.appCheckToken&&(this.p=t.settings.appCheckToken)}start(t,e){ye(this.o===void 0,3512);const n=r=>{r.error!=null&&xt("FirebaseAppCheckTokenProvider",`Error getting App Check token; using placeholder token instead. Error: ${r.error.message}`);const o=r.token!==this.m;return this.m=r.token,xt("FirebaseAppCheckTokenProvider",`Received ${o?"new":"existing"} token.`),o?e(r.token):Promise.resolve()};this.o=r=>{t.enqueueRetryable(()=>n(r))};const s=r=>{xt("FirebaseAppCheckTokenProvider","AppCheck detected"),this.appCheck=r,this.o&&this.appCheck.addTokenListener(this.o)};this.V.onInit(r=>s(r)),setTimeout(()=>{if(!this.appCheck){const r=this.V.getImmediate({optional:!0});r?s(r):xt("FirebaseAppCheckTokenProvider","AppCheck not yet detected")}},0)}getToken(){if(this.p)return Promise.resolve(new Qm(this.p));const t=this.forceRefresh;return this.forceRefresh=!1,this.appCheck?this.appCheck.getToken(t).then(e=>e?(ye(typeof e.token=="string",44558,{tokenResult:e}),this.m=e.token,new Qm(e.token)):null):Promise.resolve(null)}invalidateToken(){this.forceRefresh=!0}shutdown(){this.appCheck&&this.o&&this.appCheck.removeTokenListener(this.o),this.o=void 0}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function pI(i){const t=typeof self<"u"&&(self.crypto||self.msCrypto),e=new Uint8Array(i);if(t&&typeof t.getRandomValues=="function")t.getRandomValues(e);else for(let n=0;n<i;n++)e[n]=Math.floor(256*Math.random());return e}/**
 * @license
 * Copyright 2023 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function R0(){return new TextEncoder}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class $d{static newId(){const t="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",e=62*Math.floor(4.129032258064516);let n="";for(;n.length<20;){const s=pI(40);for(let r=0;r<s.length;++r)n.length<20&&s[r]<e&&(n+=t.charAt(s[r]%62))}return n}}function Zt(i,t){return i<t?-1:i>t?1:0}function Qh(i,t){let e=0;for(;e<i.length&&e<t.length;){const n=i.codePointAt(e),s=t.codePointAt(e);if(n!==s){if(n<128&&s<128)return Zt(n,s);{const r=R0(),o=mI(r.encode(tg(i,e)),r.encode(tg(t,e)));return o!==0?o:Zt(n,s)}}e+=n>65535?2:1}return Zt(i.length,t.length)}function tg(i,t){return i.codePointAt(t)>65535?i.substring(t,t+2):i.substring(t,t+1)}function mI(i,t){for(let e=0;e<i.length&&e<t.length;++e)if(i[e]!==t[e])return Zt(i[e],t[e]);return Zt(i.length,t.length)}function so(i,t,e){return i.length===t.length&&i.every((n,s)=>e(n,t[s]))}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const eg="__name__";class di{constructor(t,e,n){e===void 0?e=0:e>t.length&&Ft(637,{offset:e,range:t.length}),n===void 0?n=t.length-e:n>t.length-e&&Ft(1746,{length:n,range:t.length-e}),this.segments=t,this.offset=e,this.len=n}get length(){return this.len}isEqual(t){return di.comparator(this,t)===0}child(t){const e=this.segments.slice(this.offset,this.limit());return t instanceof di?t.forEach(n=>{e.push(n)}):e.push(t),this.construct(e)}limit(){return this.offset+this.length}popFirst(t){return t=t===void 0?1:t,this.construct(this.segments,this.offset+t,this.length-t)}popLast(){return this.construct(this.segments,this.offset,this.length-1)}firstSegment(){return this.segments[this.offset]}lastSegment(){return this.get(this.length-1)}get(t){return this.segments[this.offset+t]}isEmpty(){return this.length===0}isPrefixOf(t){if(t.length<this.length)return!1;for(let e=0;e<this.length;e++)if(this.get(e)!==t.get(e))return!1;return!0}isImmediateParentOf(t){if(this.length+1!==t.length)return!1;for(let e=0;e<this.length;e++)if(this.get(e)!==t.get(e))return!1;return!0}forEach(t){for(let e=this.offset,n=this.limit();e<n;e++)t(this.segments[e])}toArray(){return this.segments.slice(this.offset,this.limit())}static comparator(t,e){const n=Math.min(t.length,e.length);for(let s=0;s<n;s++){const r=di.compareSegments(t.get(s),e.get(s));if(r!==0)return r}return Zt(t.length,e.length)}static compareSegments(t,e){const n=di.isNumericId(t),s=di.isNumericId(e);return n&&!s?-1:!n&&s?1:n&&s?di.extractNumericId(t).compare(di.extractNumericId(e)):Qh(t,e)}static isNumericId(t){return t.startsWith("__id")&&t.endsWith("__")}static extractNumericId(t){return fs.fromString(t.substring(4,t.length-2))}}class Ce extends di{construct(t,e,n){return new Ce(t,e,n)}canonicalString(){return this.toArray().join("/")}toString(){return this.canonicalString()}toUriEncodedString(){return this.toArray().map(encodeURIComponent).join("/")}static fromString(...t){const e=[];for(const n of t){if(n.indexOf("//")>=0)throw new Dt(it.INVALID_ARGUMENT,`Invalid segment (${n}). Paths must not contain // in them.`);e.push(...n.split("/").filter(s=>s.length>0))}return new Ce(e)}static emptyPath(){return new Ce([])}}const gI=/^[_a-zA-Z][_a-zA-Z0-9]*$/;class dn extends di{construct(t,e,n){return new dn(t,e,n)}static isValidIdentifier(t){return gI.test(t)}canonicalString(){return this.toArray().map(t=>(t=t.replace(/\\/g,"\\\\").replace(/`/g,"\\`"),dn.isValidIdentifier(t)||(t="`"+t+"`"),t)).join(".")}toString(){return this.canonicalString()}isKeyField(){return this.length===1&&this.get(0)===eg}static keyField(){return new dn([eg])}static fromServerFormat(t){const e=[];let n="",s=0;const r=()=>{if(n.length===0)throw new Dt(it.INVALID_ARGUMENT,`Invalid field path (${t}). Paths must not be empty, begin with '.', end with '.', or contain '..'`);e.push(n),n=""};let o=!1;for(;s<t.length;){const a=t[s];if(a==="\\"){if(s+1===t.length)throw new Dt(it.INVALID_ARGUMENT,"Path has trailing escape character: "+t);const c=t[s+1];if(c!=="\\"&&c!=="."&&c!=="`")throw new Dt(it.INVALID_ARGUMENT,"Path has invalid escape sequence: "+t);n+=c,s+=2}else a==="`"?(o=!o,s++):a!=="."||o?(n+=a,s++):(r(),s++)}if(r(),o)throw new Dt(it.INVALID_ARGUMENT,"Unterminated ` in path: "+t);return new dn(e)}static emptyPath(){return new dn([])}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Lt{constructor(t){this.path=t}static fromPath(t){return new Lt(Ce.fromString(t))}static fromName(t){return new Lt(Ce.fromString(t).popFirst(5))}static empty(){return new Lt(Ce.emptyPath())}get collectionGroup(){return this.path.popLast().lastSegment()}hasCollectionId(t){return this.path.length>=2&&this.path.get(this.path.length-2)===t}getCollectionGroup(){return this.path.get(this.path.length-2)}getCollectionPath(){return this.path.popLast()}isEqual(t){return t!==null&&Ce.comparator(this.path,t.path)===0}toString(){return this.path.toString()}static comparator(t,e){return Ce.comparator(t.path,e.path)}static isDocumentKey(t){return t.length%2==0}static fromSegments(t){return new Lt(new Ce(t.slice()))}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function I0(i,t,e){if(!e)throw new Dt(it.INVALID_ARGUMENT,`Function ${i}() cannot be called with an empty ${t}.`)}function _I(i,t,e,n){if(t===!0&&n===!0)throw new Dt(it.INVALID_ARGUMENT,`${i} and ${e} cannot be used together.`)}function ng(i){if(!Lt.isDocumentKey(i))throw new Dt(it.INVALID_ARGUMENT,`Invalid document reference. Document references must have an even number of segments, but ${i} has ${i.length}.`)}function ig(i){if(Lt.isDocumentKey(i))throw new Dt(it.INVALID_ARGUMENT,`Invalid collection reference. Collection references must have an odd number of segments, but ${i} has ${i.length}.`)}function C0(i){return typeof i=="object"&&i!==null&&(Object.getPrototypeOf(i)===Object.prototype||Object.getPrototypeOf(i)===null)}function Yd(i){if(i===void 0)return"undefined";if(i===null)return"null";if(typeof i=="string")return i.length>20&&(i=`${i.substring(0,20)}...`),JSON.stringify(i);if(typeof i=="number"||typeof i=="boolean")return""+i;if(typeof i=="object"){if(i instanceof Array)return"an array";{const t=function(n){return n.constructor?n.constructor.name:null}(i);return t?`a custom ${t} object`:"an object"}}return typeof i=="function"?"a function":Ft(12329,{type:typeof i})}function qs(i,t){if("_delegate"in i&&(i=i._delegate),!(i instanceof t)){if(t.name===i.constructor.name)throw new Dt(it.INVALID_ARGUMENT,"Type does not match the expected instance. Did you pass a reference from a different Firestore SDK?");{const e=Yd(i);throw new Dt(it.INVALID_ARGUMENT,`Expected type '${t.name}', but it was: ${e}`)}}return i}/**
 * @license
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function qe(i,t){const e={typeString:i};return t&&(e.value=t),e}function La(i,t){if(!C0(i))throw new Dt(it.INVALID_ARGUMENT,"JSON must be an object");let e;for(const n in t)if(t[n]){const s=t[n].typeString,r="value"in t[n]?{value:t[n].value}:void 0;if(!(n in i)){e=`JSON missing required field: '${n}'`;break}const o=i[n];if(s&&typeof o!==s){e=`JSON field '${n}' must be a ${s}.`;break}if(r!==void 0&&o!==r.value){e=`Expected '${n}' field to equal '${r.value}'`;break}}if(e)throw new Dt(it.INVALID_ARGUMENT,e);return!0}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const sg=-62135596800,rg=1e6;class Pe{static now(){return Pe.fromMillis(Date.now())}static fromDate(t){return Pe.fromMillis(t.getTime())}static fromMillis(t){const e=Math.floor(t/1e3),n=Math.floor((t-1e3*e)*rg);return new Pe(e,n)}constructor(t,e){if(this.seconds=t,this.nanoseconds=e,e<0)throw new Dt(it.INVALID_ARGUMENT,"Timestamp nanoseconds out of range: "+e);if(e>=1e9)throw new Dt(it.INVALID_ARGUMENT,"Timestamp nanoseconds out of range: "+e);if(t<sg)throw new Dt(it.INVALID_ARGUMENT,"Timestamp seconds out of range: "+t);if(t>=253402300800)throw new Dt(it.INVALID_ARGUMENT,"Timestamp seconds out of range: "+t)}toDate(){return new Date(this.toMillis())}toMillis(){return 1e3*this.seconds+this.nanoseconds/rg}_compareTo(t){return this.seconds===t.seconds?Zt(this.nanoseconds,t.nanoseconds):Zt(this.seconds,t.seconds)}isEqual(t){return t.seconds===this.seconds&&t.nanoseconds===this.nanoseconds}toString(){return"Timestamp(seconds="+this.seconds+", nanoseconds="+this.nanoseconds+")"}toJSON(){return{type:Pe._jsonSchemaVersion,seconds:this.seconds,nanoseconds:this.nanoseconds}}static fromJSON(t){if(La(t,Pe._jsonSchema))return new Pe(t.seconds,t.nanoseconds)}valueOf(){const t=this.seconds-sg;return String(t).padStart(12,"0")+"."+String(this.nanoseconds).padStart(9,"0")}}Pe._jsonSchemaVersion="firestore/timestamp/1.0",Pe._jsonSchema={type:qe("string",Pe._jsonSchemaVersion),seconds:qe("number"),nanoseconds:qe("number")};/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Wt{static fromTimestamp(t){return new Wt(t)}static min(){return new Wt(new Pe(0,0))}static max(){return new Wt(new Pe(253402300799,999999999))}constructor(t){this.timestamp=t}compareTo(t){return this.timestamp._compareTo(t.timestamp)}isEqual(t){return this.timestamp.isEqual(t.timestamp)}toMicroseconds(){return 1e6*this.timestamp.seconds+this.timestamp.nanoseconds/1e3}toString(){return"SnapshotVersion("+this.timestamp.toString()+")"}toTimestamp(){return this.timestamp}}/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Ea=-1;function vI(i,t){const e=i.toTimestamp().seconds,n=i.toTimestamp().nanoseconds+1,s=Wt.fromTimestamp(n===1e9?new Pe(e+1,0):new Pe(e,n));return new ys(s,Lt.empty(),t)}function yI(i){return new ys(i.readTime,i.key,Ea)}class ys{constructor(t,e,n){this.readTime=t,this.documentKey=e,this.largestBatchId=n}static min(){return new ys(Wt.min(),Lt.empty(),Ea)}static max(){return new ys(Wt.max(),Lt.empty(),Ea)}}function xI(i,t){let e=i.readTime.compareTo(t.readTime);return e!==0?e:(e=Lt.comparator(i.documentKey,t.documentKey),e!==0?e:Zt(i.largestBatchId,t.largestBatchId))}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const EI="The current tab is not in the required state to perform this operation. It might be necessary to refresh the browser tab.";class TI{constructor(){this.onCommittedListeners=[]}addOnCommittedListener(t){this.onCommittedListeners.push(t)}raiseOnCommittedEvent(){this.onCommittedListeners.forEach(t=>t())}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function go(i){if(i.code!==it.FAILED_PRECONDITION||i.message!==EI)throw i;xt("LocalStore","Unexpectedly lost primary lease")}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class tt{constructor(t){this.nextCallback=null,this.catchCallback=null,this.result=void 0,this.error=void 0,this.isDone=!1,this.callbackAttached=!1,t(e=>{this.isDone=!0,this.result=e,this.nextCallback&&this.nextCallback(e)},e=>{this.isDone=!0,this.error=e,this.catchCallback&&this.catchCallback(e)})}catch(t){return this.next(void 0,t)}next(t,e){return this.callbackAttached&&Ft(59440),this.callbackAttached=!0,this.isDone?this.error?this.wrapFailure(e,this.error):this.wrapSuccess(t,this.result):new tt((n,s)=>{this.nextCallback=r=>{this.wrapSuccess(t,r).next(n,s)},this.catchCallback=r=>{this.wrapFailure(e,r).next(n,s)}})}toPromise(){return new Promise((t,e)=>{this.next(t,e)})}wrapUserFunction(t){try{const e=t();return e instanceof tt?e:tt.resolve(e)}catch(e){return tt.reject(e)}}wrapSuccess(t,e){return t?this.wrapUserFunction(()=>t(e)):tt.resolve(e)}wrapFailure(t,e){return t?this.wrapUserFunction(()=>t(e)):tt.reject(e)}static resolve(t){return new tt((e,n)=>{e(t)})}static reject(t){return new tt((e,n)=>{n(t)})}static waitFor(t){return new tt((e,n)=>{let s=0,r=0,o=!1;t.forEach(a=>{++s,a.next(()=>{++r,o&&r===s&&e()},c=>n(c))}),o=!0,r===s&&e()})}static or(t){let e=tt.resolve(!1);for(const n of t)e=e.next(s=>s?tt.resolve(s):n());return e}static forEach(t,e){const n=[];return t.forEach((s,r)=>{n.push(e.call(this,s,r))}),this.waitFor(n)}static mapArray(t,e){return new tt((n,s)=>{const r=t.length,o=new Array(r);let a=0;for(let c=0;c<r;c++){const l=c;e(t[l]).next(h=>{o[l]=h,++a,a===r&&n(o)},h=>s(h))}})}static doWhile(t,e){return new tt((n,s)=>{const r=()=>{t()===!0?e().next(()=>{r()},s):n()};r()})}}function SI(i){const t=i.match(/Android ([\d.]+)/i),e=t?t[1].split(".").slice(0,2).join("."):"-1";return Number(e)}function _o(i){return i.name==="IndexedDbTransactionError"}/**
 * @license
 * Copyright 2018 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Pl{constructor(t,e){this.previousValue=t,e&&(e.sequenceNumberHandler=n=>this._e(n),this.ae=n=>e.writeSequenceNumber(n))}_e(t){return this.previousValue=Math.max(t,this.previousValue),this.previousValue}next(){const t=++this.previousValue;return this.ae&&this.ae(t),t}}Pl.ue=-1;/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Jd=-1;function Dl(i){return i==null}function fl(i){return i===0&&1/i==-1/0}function AI(i){return typeof i=="number"&&Number.isInteger(i)&&!fl(i)&&i<=Number.MAX_SAFE_INTEGER&&i>=Number.MIN_SAFE_INTEGER}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const P0="";function MI(i){let t="";for(let e=0;e<i.length;e++)t.length>0&&(t=og(t)),t=wI(i.get(e),t);return og(t)}function wI(i,t){let e=t;const n=i.length;for(let s=0;s<n;s++){const r=i.charAt(s);switch(r){case"\0":e+="";break;case P0:e+="";break;default:e+=r}}return e}function og(i){return i+P0+""}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function ag(i){let t=0;for(const e in i)Object.prototype.hasOwnProperty.call(i,e)&&t++;return t}function tr(i,t){for(const e in i)Object.prototype.hasOwnProperty.call(i,e)&&t(e,i[e])}function D0(i){for(const t in i)if(Object.prototype.hasOwnProperty.call(i,t))return!1;return!0}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Oe{constructor(t,e){this.comparator=t,this.root=e||un.EMPTY}insert(t,e){return new Oe(this.comparator,this.root.insert(t,e,this.comparator).copy(null,null,un.BLACK,null,null))}remove(t){return new Oe(this.comparator,this.root.remove(t,this.comparator).copy(null,null,un.BLACK,null,null))}get(t){let e=this.root;for(;!e.isEmpty();){const n=this.comparator(t,e.key);if(n===0)return e.value;n<0?e=e.left:n>0&&(e=e.right)}return null}indexOf(t){let e=0,n=this.root;for(;!n.isEmpty();){const s=this.comparator(t,n.key);if(s===0)return e+n.left.size;s<0?n=n.left:(e+=n.left.size+1,n=n.right)}return-1}isEmpty(){return this.root.isEmpty()}get size(){return this.root.size}minKey(){return this.root.minKey()}maxKey(){return this.root.maxKey()}inorderTraversal(t){return this.root.inorderTraversal(t)}forEach(t){this.inorderTraversal((e,n)=>(t(e,n),!1))}toString(){const t=[];return this.inorderTraversal((e,n)=>(t.push(`${e}:${n}`),!1)),`{${t.join(", ")}}`}reverseTraversal(t){return this.root.reverseTraversal(t)}getIterator(){return new Cc(this.root,null,this.comparator,!1)}getIteratorFrom(t){return new Cc(this.root,t,this.comparator,!1)}getReverseIterator(){return new Cc(this.root,null,this.comparator,!0)}getReverseIteratorFrom(t){return new Cc(this.root,t,this.comparator,!0)}}class Cc{constructor(t,e,n,s){this.isReverse=s,this.nodeStack=[];let r=1;for(;!t.isEmpty();)if(r=e?n(t.key,e):1,e&&s&&(r*=-1),r<0)t=this.isReverse?t.left:t.right;else{if(r===0){this.nodeStack.push(t);break}this.nodeStack.push(t),t=this.isReverse?t.right:t.left}}getNext(){let t=this.nodeStack.pop();const e={key:t.key,value:t.value};if(this.isReverse)for(t=t.left;!t.isEmpty();)this.nodeStack.push(t),t=t.right;else for(t=t.right;!t.isEmpty();)this.nodeStack.push(t),t=t.left;return e}hasNext(){return this.nodeStack.length>0}peek(){if(this.nodeStack.length===0)return null;const t=this.nodeStack[this.nodeStack.length-1];return{key:t.key,value:t.value}}}class un{constructor(t,e,n,s,r){this.key=t,this.value=e,this.color=n??un.RED,this.left=s??un.EMPTY,this.right=r??un.EMPTY,this.size=this.left.size+1+this.right.size}copy(t,e,n,s,r){return new un(t??this.key,e??this.value,n??this.color,s??this.left,r??this.right)}isEmpty(){return!1}inorderTraversal(t){return this.left.inorderTraversal(t)||t(this.key,this.value)||this.right.inorderTraversal(t)}reverseTraversal(t){return this.right.reverseTraversal(t)||t(this.key,this.value)||this.left.reverseTraversal(t)}min(){return this.left.isEmpty()?this:this.left.min()}minKey(){return this.min().key}maxKey(){return this.right.isEmpty()?this.key:this.right.maxKey()}insert(t,e,n){let s=this;const r=n(t,s.key);return s=r<0?s.copy(null,null,null,s.left.insert(t,e,n),null):r===0?s.copy(null,e,null,null,null):s.copy(null,null,null,null,s.right.insert(t,e,n)),s.fixUp()}removeMin(){if(this.left.isEmpty())return un.EMPTY;let t=this;return t.left.isRed()||t.left.left.isRed()||(t=t.moveRedLeft()),t=t.copy(null,null,null,t.left.removeMin(),null),t.fixUp()}remove(t,e){let n,s=this;if(e(t,s.key)<0)s.left.isEmpty()||s.left.isRed()||s.left.left.isRed()||(s=s.moveRedLeft()),s=s.copy(null,null,null,s.left.remove(t,e),null);else{if(s.left.isRed()&&(s=s.rotateRight()),s.right.isEmpty()||s.right.isRed()||s.right.left.isRed()||(s=s.moveRedRight()),e(t,s.key)===0){if(s.right.isEmpty())return un.EMPTY;n=s.right.min(),s=s.copy(n.key,n.value,null,null,s.right.removeMin())}s=s.copy(null,null,null,null,s.right.remove(t,e))}return s.fixUp()}isRed(){return this.color}fixUp(){let t=this;return t.right.isRed()&&!t.left.isRed()&&(t=t.rotateLeft()),t.left.isRed()&&t.left.left.isRed()&&(t=t.rotateRight()),t.left.isRed()&&t.right.isRed()&&(t=t.colorFlip()),t}moveRedLeft(){let t=this.colorFlip();return t.right.left.isRed()&&(t=t.copy(null,null,null,null,t.right.rotateRight()),t=t.rotateLeft(),t=t.colorFlip()),t}moveRedRight(){let t=this.colorFlip();return t.left.left.isRed()&&(t=t.rotateRight(),t=t.colorFlip()),t}rotateLeft(){const t=this.copy(null,null,un.RED,null,this.right.left);return this.right.copy(null,null,this.color,t,null)}rotateRight(){const t=this.copy(null,null,un.RED,this.left.right,null);return this.left.copy(null,null,this.color,null,t)}colorFlip(){const t=this.left.copy(null,null,!this.left.color,null,null),e=this.right.copy(null,null,!this.right.color,null,null);return this.copy(null,null,!this.color,t,e)}checkMaxDepth(){const t=this.check();return Math.pow(2,t)<=this.size+1}check(){if(this.isRed()&&this.left.isRed())throw Ft(43730,{key:this.key,value:this.value});if(this.right.isRed())throw Ft(14113,{key:this.key,value:this.value});const t=this.left.check();if(t!==this.right.check())throw Ft(27949);return t+(this.isRed()?0:1)}}un.EMPTY=null,un.RED=!0,un.BLACK=!1;un.EMPTY=new class{constructor(){this.size=0}get key(){throw Ft(57766)}get value(){throw Ft(16141)}get color(){throw Ft(16727)}get left(){throw Ft(29726)}get right(){throw Ft(36894)}copy(t,e,n,s,r){return this}insert(t,e,n){return new un(t,e)}remove(t,e){return this}isEmpty(){return!0}inorderTraversal(t){return!1}reverseTraversal(t){return!1}minKey(){return null}maxKey(){return null}isRed(){return!1}checkMaxDepth(){return!0}check(){return 0}};/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Qe{constructor(t){this.comparator=t,this.data=new Oe(this.comparator)}has(t){return this.data.get(t)!==null}first(){return this.data.minKey()}last(){return this.data.maxKey()}get size(){return this.data.size}indexOf(t){return this.data.indexOf(t)}forEach(t){this.data.inorderTraversal((e,n)=>(t(e),!1))}forEachInRange(t,e){const n=this.data.getIteratorFrom(t[0]);for(;n.hasNext();){const s=n.getNext();if(this.comparator(s.key,t[1])>=0)return;e(s.key)}}forEachWhile(t,e){let n;for(n=e!==void 0?this.data.getIteratorFrom(e):this.data.getIterator();n.hasNext();)if(!t(n.getNext().key))return}firstAfterOrEqual(t){const e=this.data.getIteratorFrom(t);return e.hasNext()?e.getNext().key:null}getIterator(){return new cg(this.data.getIterator())}getIteratorFrom(t){return new cg(this.data.getIteratorFrom(t))}add(t){return this.copy(this.data.remove(t).insert(t,!0))}delete(t){return this.has(t)?this.copy(this.data.remove(t)):this}isEmpty(){return this.data.isEmpty()}unionWith(t){let e=this;return e.size<t.size&&(e=t,t=this),t.forEach(n=>{e=e.add(n)}),e}isEqual(t){if(!(t instanceof Qe)||this.size!==t.size)return!1;const e=this.data.getIterator(),n=t.data.getIterator();for(;e.hasNext();){const s=e.getNext().key,r=n.getNext().key;if(this.comparator(s,r)!==0)return!1}return!0}toArray(){const t=[];return this.forEach(e=>{t.push(e)}),t}toString(){const t=[];return this.forEach(e=>t.push(e)),"SortedSet("+t.toString()+")"}copy(t){const e=new Qe(this.comparator);return e.data=t,e}}class cg{constructor(t){this.iter=t}getNext(){return this.iter.getNext().key}hasNext(){return this.iter.hasNext()}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class ri{constructor(t){this.fields=t,t.sort(dn.comparator)}static empty(){return new ri([])}unionWith(t){let e=new Qe(dn.comparator);for(const n of this.fields)e=e.add(n);for(const n of t)e=e.add(n);return new ri(e.toArray())}covers(t){for(const e of this.fields)if(e.isPrefixOf(t))return!0;return!1}isEqual(t){return so(this.fields,t.fields,(e,n)=>e.isEqual(n))}}/**
 * @license
 * Copyright 2023 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class L0 extends Error{constructor(){super(...arguments),this.name="Base64DecodeError"}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class pn{constructor(t){this.binaryString=t}static fromBase64String(t){const e=function(s){try{return atob(s)}catch(r){throw typeof DOMException<"u"&&r instanceof DOMException?new L0("Invalid base64 string: "+r):r}}(t);return new pn(e)}static fromUint8Array(t){const e=function(s){let r="";for(let o=0;o<s.length;++o)r+=String.fromCharCode(s[o]);return r}(t);return new pn(e)}[Symbol.iterator](){let t=0;return{next:()=>t<this.binaryString.length?{value:this.binaryString.charCodeAt(t++),done:!1}:{value:void 0,done:!0}}}toBase64(){return function(e){return btoa(e)}(this.binaryString)}toUint8Array(){return function(e){const n=new Uint8Array(e.length);for(let s=0;s<e.length;s++)n[s]=e.charCodeAt(s);return n}(this.binaryString)}approximateByteSize(){return 2*this.binaryString.length}compareTo(t){return Zt(this.binaryString,t.binaryString)}isEqual(t){return this.binaryString===t.binaryString}}pn.EMPTY_BYTE_STRING=new pn("");const bI=new RegExp(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.(\d+))?Z$/);function xs(i){if(ye(!!i,39018),typeof i=="string"){let t=0;const e=bI.exec(i);if(ye(!!e,46558,{timestamp:i}),e[1]){let s=e[1];s=(s+"000000000").substr(0,9),t=Number(s)}const n=new Date(i);return{seconds:Math.floor(n.getTime()/1e3),nanos:t}}return{seconds:ke(i.seconds),nanos:ke(i.nanos)}}function ke(i){return typeof i=="number"?i:typeof i=="string"?Number(i):0}function Es(i){return typeof i=="string"?pn.fromBase64String(i):pn.fromUint8Array(i)}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const N0="server_timestamp",U0="__type__",O0="__previous_value__",F0="__local_write_time__";function Zd(i){var t,e;return((e=(((t=i?.mapValue)===null||t===void 0?void 0:t.fields)||{})[U0])===null||e===void 0?void 0:e.stringValue)===N0}function Ll(i){const t=i.mapValue.fields[O0];return Zd(t)?Ll(t):t}function Ta(i){const t=xs(i.mapValue.fields[F0].timestampValue);return new Pe(t.seconds,t.nanos)}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class RI{constructor(t,e,n,s,r,o,a,c,l,h){this.databaseId=t,this.appId=e,this.persistenceKey=n,this.host=s,this.ssl=r,this.forceLongPolling=o,this.autoDetectLongPolling=a,this.longPollingOptions=c,this.useFetchStreams=l,this.isUsingEmulator=h}}const pl="(default)";class Sa{constructor(t,e){this.projectId=t,this.database=e||pl}static empty(){return new Sa("","")}get isDefaultDatabase(){return this.database===pl}isEqual(t){return t instanceof Sa&&t.projectId===this.projectId&&t.database===this.database}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const V0="__type__",II="__max__",Pc={mapValue:{}},B0="__vector__",ml="value";function Ts(i){return"nullValue"in i?0:"booleanValue"in i?1:"integerValue"in i||"doubleValue"in i?2:"timestampValue"in i?3:"stringValue"in i?5:"bytesValue"in i?6:"referenceValue"in i?7:"geoPointValue"in i?8:"arrayValue"in i?9:"mapValue"in i?Zd(i)?4:PI(i)?9007199254740991:CI(i)?10:11:Ft(28295,{value:i})}function xi(i,t){if(i===t)return!0;const e=Ts(i);if(e!==Ts(t))return!1;switch(e){case 0:case 9007199254740991:return!0;case 1:return i.booleanValue===t.booleanValue;case 4:return Ta(i).isEqual(Ta(t));case 3:return function(s,r){if(typeof s.timestampValue=="string"&&typeof r.timestampValue=="string"&&s.timestampValue.length===r.timestampValue.length)return s.timestampValue===r.timestampValue;const o=xs(s.timestampValue),a=xs(r.timestampValue);return o.seconds===a.seconds&&o.nanos===a.nanos}(i,t);case 5:return i.stringValue===t.stringValue;case 6:return function(s,r){return Es(s.bytesValue).isEqual(Es(r.bytesValue))}(i,t);case 7:return i.referenceValue===t.referenceValue;case 8:return function(s,r){return ke(s.geoPointValue.latitude)===ke(r.geoPointValue.latitude)&&ke(s.geoPointValue.longitude)===ke(r.geoPointValue.longitude)}(i,t);case 2:return function(s,r){if("integerValue"in s&&"integerValue"in r)return ke(s.integerValue)===ke(r.integerValue);if("doubleValue"in s&&"doubleValue"in r){const o=ke(s.doubleValue),a=ke(r.doubleValue);return o===a?fl(o)===fl(a):isNaN(o)&&isNaN(a)}return!1}(i,t);case 9:return so(i.arrayValue.values||[],t.arrayValue.values||[],xi);case 10:case 11:return function(s,r){const o=s.mapValue.fields||{},a=r.mapValue.fields||{};if(ag(o)!==ag(a))return!1;for(const c in o)if(o.hasOwnProperty(c)&&(a[c]===void 0||!xi(o[c],a[c])))return!1;return!0}(i,t);default:return Ft(52216,{left:i})}}function Aa(i,t){return(i.values||[]).find(e=>xi(e,t))!==void 0}function ro(i,t){if(i===t)return 0;const e=Ts(i),n=Ts(t);if(e!==n)return Zt(e,n);switch(e){case 0:case 9007199254740991:return 0;case 1:return Zt(i.booleanValue,t.booleanValue);case 2:return function(r,o){const a=ke(r.integerValue||r.doubleValue),c=ke(o.integerValue||o.doubleValue);return a<c?-1:a>c?1:a===c?0:isNaN(a)?isNaN(c)?0:-1:1}(i,t);case 3:return lg(i.timestampValue,t.timestampValue);case 4:return lg(Ta(i),Ta(t));case 5:return Qh(i.stringValue,t.stringValue);case 6:return function(r,o){const a=Es(r),c=Es(o);return a.compareTo(c)}(i.bytesValue,t.bytesValue);case 7:return function(r,o){const a=r.split("/"),c=o.split("/");for(let l=0;l<a.length&&l<c.length;l++){const h=Zt(a[l],c[l]);if(h!==0)return h}return Zt(a.length,c.length)}(i.referenceValue,t.referenceValue);case 8:return function(r,o){const a=Zt(ke(r.latitude),ke(o.latitude));return a!==0?a:Zt(ke(r.longitude),ke(o.longitude))}(i.geoPointValue,t.geoPointValue);case 9:return ug(i.arrayValue,t.arrayValue);case 10:return function(r,o){var a,c,l,h;const d=r.fields||{},f=o.fields||{},p=(a=d[ml])===null||a===void 0?void 0:a.arrayValue,v=(c=f[ml])===null||c===void 0?void 0:c.arrayValue,x=Zt(((l=p?.values)===null||l===void 0?void 0:l.length)||0,((h=v?.values)===null||h===void 0?void 0:h.length)||0);return x!==0?x:ug(p,v)}(i.mapValue,t.mapValue);case 11:return function(r,o){if(r===Pc.mapValue&&o===Pc.mapValue)return 0;if(r===Pc.mapValue)return 1;if(o===Pc.mapValue)return-1;const a=r.fields||{},c=Object.keys(a),l=o.fields||{},h=Object.keys(l);c.sort(),h.sort();for(let d=0;d<c.length&&d<h.length;++d){const f=Qh(c[d],h[d]);if(f!==0)return f;const p=ro(a[c[d]],l[h[d]]);if(p!==0)return p}return Zt(c.length,h.length)}(i.mapValue,t.mapValue);default:throw Ft(23264,{le:e})}}function lg(i,t){if(typeof i=="string"&&typeof t=="string"&&i.length===t.length)return Zt(i,t);const e=xs(i),n=xs(t),s=Zt(e.seconds,n.seconds);return s!==0?s:Zt(e.nanos,n.nanos)}function ug(i,t){const e=i.values||[],n=t.values||[];for(let s=0;s<e.length&&s<n.length;++s){const r=ro(e[s],n[s]);if(r)return r}return Zt(e.length,n.length)}function oo(i){return td(i)}function td(i){return"nullValue"in i?"null":"booleanValue"in i?""+i.booleanValue:"integerValue"in i?""+i.integerValue:"doubleValue"in i?""+i.doubleValue:"timestampValue"in i?function(e){const n=xs(e);return`time(${n.seconds},${n.nanos})`}(i.timestampValue):"stringValue"in i?i.stringValue:"bytesValue"in i?function(e){return Es(e).toBase64()}(i.bytesValue):"referenceValue"in i?function(e){return Lt.fromName(e).toString()}(i.referenceValue):"geoPointValue"in i?function(e){return`geo(${e.latitude},${e.longitude})`}(i.geoPointValue):"arrayValue"in i?function(e){let n="[",s=!0;for(const r of e.values||[])s?s=!1:n+=",",n+=td(r);return n+"]"}(i.arrayValue):"mapValue"in i?function(e){const n=Object.keys(e.fields||{}).sort();let s="{",r=!0;for(const o of n)r?r=!1:s+=",",s+=`${o}:${td(e.fields[o])}`;return s+"}"}(i.mapValue):Ft(61005,{value:i})}function Xc(i){switch(Ts(i)){case 0:case 1:return 4;case 2:return 8;case 3:case 8:return 16;case 4:const t=Ll(i);return t?16+Xc(t):16;case 5:return 2*i.stringValue.length;case 6:return Es(i.bytesValue).approximateByteSize();case 7:return i.referenceValue.length;case 9:return function(n){return(n.values||[]).reduce((s,r)=>s+Xc(r),0)}(i.arrayValue);case 10:case 11:return function(n){let s=0;return tr(n.fields,(r,o)=>{s+=r.length+Xc(o)}),s}(i.mapValue);default:throw Ft(13486,{value:i})}}function ed(i){return!!i&&"integerValue"in i}function Qd(i){return!!i&&"arrayValue"in i}function hg(i){return!!i&&"nullValue"in i}function dg(i){return!!i&&"doubleValue"in i&&isNaN(Number(i.doubleValue))}function qc(i){return!!i&&"mapValue"in i}function CI(i){var t,e;return((e=(((t=i?.mapValue)===null||t===void 0?void 0:t.fields)||{})[V0])===null||e===void 0?void 0:e.stringValue)===B0}function ra(i){if(i.geoPointValue)return{geoPointValue:Object.assign({},i.geoPointValue)};if(i.timestampValue&&typeof i.timestampValue=="object")return{timestampValue:Object.assign({},i.timestampValue)};if(i.mapValue){const t={mapValue:{fields:{}}};return tr(i.mapValue.fields,(e,n)=>t.mapValue.fields[e]=ra(n)),t}if(i.arrayValue){const t={arrayValue:{values:[]}};for(let e=0;e<(i.arrayValue.values||[]).length;++e)t.arrayValue.values[e]=ra(i.arrayValue.values[e]);return t}return Object.assign({},i)}function PI(i){return(((i.mapValue||{}).fields||{}).__type__||{}).stringValue===II}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Gn{constructor(t){this.value=t}static empty(){return new Gn({mapValue:{}})}field(t){if(t.isEmpty())return this.value;{let e=this.value;for(let n=0;n<t.length-1;++n)if(e=(e.mapValue.fields||{})[t.get(n)],!qc(e))return null;return e=(e.mapValue.fields||{})[t.lastSegment()],e||null}}set(t,e){this.getFieldsMap(t.popLast())[t.lastSegment()]=ra(e)}setAll(t){let e=dn.emptyPath(),n={},s=[];t.forEach((o,a)=>{if(!e.isImmediateParentOf(a)){const c=this.getFieldsMap(e);this.applyChanges(c,n,s),n={},s=[],e=a.popLast()}o?n[a.lastSegment()]=ra(o):s.push(a.lastSegment())});const r=this.getFieldsMap(e);this.applyChanges(r,n,s)}delete(t){const e=this.field(t.popLast());qc(e)&&e.mapValue.fields&&delete e.mapValue.fields[t.lastSegment()]}isEqual(t){return xi(this.value,t.value)}getFieldsMap(t){let e=this.value;e.mapValue.fields||(e.mapValue={fields:{}});for(let n=0;n<t.length;++n){let s=e.mapValue.fields[t.get(n)];qc(s)&&s.mapValue.fields||(s={mapValue:{fields:{}}},e.mapValue.fields[t.get(n)]=s),e=s}return e.mapValue.fields}applyChanges(t,e,n){tr(e,(s,r)=>t[s]=r);for(const s of n)delete t[s]}clone(){return new Gn(ra(this.value))}}function k0(i){const t=[];return tr(i.fields,(e,n)=>{const s=new dn([e]);if(qc(n)){const r=k0(n.mapValue).fields;if(r.length===0)t.push(s);else for(const o of r)t.push(s.child(o))}else t.push(s)}),new ri(t)}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Sn{constructor(t,e,n,s,r,o,a){this.key=t,this.documentType=e,this.version=n,this.readTime=s,this.createTime=r,this.data=o,this.documentState=a}static newInvalidDocument(t){return new Sn(t,0,Wt.min(),Wt.min(),Wt.min(),Gn.empty(),0)}static newFoundDocument(t,e,n,s){return new Sn(t,1,e,Wt.min(),n,s,0)}static newNoDocument(t,e){return new Sn(t,2,e,Wt.min(),Wt.min(),Gn.empty(),0)}static newUnknownDocument(t,e){return new Sn(t,3,e,Wt.min(),Wt.min(),Gn.empty(),2)}convertToFoundDocument(t,e){return!this.createTime.isEqual(Wt.min())||this.documentType!==2&&this.documentType!==0||(this.createTime=t),this.version=t,this.documentType=1,this.data=e,this.documentState=0,this}convertToNoDocument(t){return this.version=t,this.documentType=2,this.data=Gn.empty(),this.documentState=0,this}convertToUnknownDocument(t){return this.version=t,this.documentType=3,this.data=Gn.empty(),this.documentState=2,this}setHasCommittedMutations(){return this.documentState=2,this}setHasLocalMutations(){return this.documentState=1,this.version=Wt.min(),this}setReadTime(t){return this.readTime=t,this}get hasLocalMutations(){return this.documentState===1}get hasCommittedMutations(){return this.documentState===2}get hasPendingWrites(){return this.hasLocalMutations||this.hasCommittedMutations}isValidDocument(){return this.documentType!==0}isFoundDocument(){return this.documentType===1}isNoDocument(){return this.documentType===2}isUnknownDocument(){return this.documentType===3}isEqual(t){return t instanceof Sn&&this.key.isEqual(t.key)&&this.version.isEqual(t.version)&&this.documentType===t.documentType&&this.documentState===t.documentState&&this.data.isEqual(t.data)}mutableCopy(){return new Sn(this.key,this.documentType,this.version,this.readTime,this.createTime,this.data.clone(),this.documentState)}toString(){return`Document(${this.key}, ${this.version}, ${JSON.stringify(this.data.value)}, {createTime: ${this.createTime}}), {documentType: ${this.documentType}}), {documentState: ${this.documentState}})`}}/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class gl{constructor(t,e){this.position=t,this.inclusive=e}}function fg(i,t,e){let n=0;for(let s=0;s<i.position.length;s++){const r=t[s],o=i.position[s];if(r.field.isKeyField()?n=Lt.comparator(Lt.fromName(o.referenceValue),e.key):n=ro(o,e.data.field(r.field)),r.dir==="desc"&&(n*=-1),n!==0)break}return n}function pg(i,t){if(i===null)return t===null;if(t===null||i.inclusive!==t.inclusive||i.position.length!==t.position.length)return!1;for(let e=0;e<i.position.length;e++)if(!xi(i.position[e],t.position[e]))return!1;return!0}/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class _l{constructor(t,e="asc"){this.field=t,this.dir=e}}function DI(i,t){return i.dir===t.dir&&i.field.isEqual(t.field)}/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class z0{}class Ye extends z0{constructor(t,e,n){super(),this.field=t,this.op=e,this.value=n}static create(t,e,n){return t.isKeyField()?e==="in"||e==="not-in"?this.createKeyFieldInFilter(t,e,n):new NI(t,e,n):e==="array-contains"?new FI(t,n):e==="in"?new VI(t,n):e==="not-in"?new BI(t,n):e==="array-contains-any"?new kI(t,n):new Ye(t,e,n)}static createKeyFieldInFilter(t,e,n){return e==="in"?new UI(t,n):new OI(t,n)}matches(t){const e=t.data.field(this.field);return this.op==="!="?e!==null&&e.nullValue===void 0&&this.matchesComparison(ro(e,this.value)):e!==null&&Ts(this.value)===Ts(e)&&this.matchesComparison(ro(e,this.value))}matchesComparison(t){switch(this.op){case"<":return t<0;case"<=":return t<=0;case"==":return t===0;case"!=":return t!==0;case">":return t>0;case">=":return t>=0;default:return Ft(47266,{operator:this.op})}}isInequality(){return["<","<=",">",">=","!=","not-in"].indexOf(this.op)>=0}getFlattenedFilters(){return[this]}getFilters(){return[this]}}class Ei extends z0{constructor(t,e){super(),this.filters=t,this.op=e,this.he=null}static create(t,e){return new Ei(t,e)}matches(t){return H0(this)?this.filters.find(e=>!e.matches(t))===void 0:this.filters.find(e=>e.matches(t))!==void 0}getFlattenedFilters(){return this.he!==null||(this.he=this.filters.reduce((t,e)=>t.concat(e.getFlattenedFilters()),[])),this.he}getFilters(){return Object.assign([],this.filters)}}function H0(i){return i.op==="and"}function G0(i){return LI(i)&&H0(i)}function LI(i){for(const t of i.filters)if(t instanceof Ei)return!1;return!0}function nd(i){if(i instanceof Ye)return i.field.canonicalString()+i.op.toString()+oo(i.value);if(G0(i))return i.filters.map(t=>nd(t)).join(",");{const t=i.filters.map(e=>nd(e)).join(",");return`${i.op}(${t})`}}function W0(i,t){return i instanceof Ye?function(n,s){return s instanceof Ye&&n.op===s.op&&n.field.isEqual(s.field)&&xi(n.value,s.value)}(i,t):i instanceof Ei?function(n,s){return s instanceof Ei&&n.op===s.op&&n.filters.length===s.filters.length?n.filters.reduce((r,o,a)=>r&&W0(o,s.filters[a]),!0):!1}(i,t):void Ft(19439)}function X0(i){return i instanceof Ye?function(e){return`${e.field.canonicalString()} ${e.op} ${oo(e.value)}`}(i):i instanceof Ei?function(e){return e.op.toString()+" {"+e.getFilters().map(X0).join(" ,")+"}"}(i):"Filter"}class NI extends Ye{constructor(t,e,n){super(t,e,n),this.key=Lt.fromName(n.referenceValue)}matches(t){const e=Lt.comparator(t.key,this.key);return this.matchesComparison(e)}}class UI extends Ye{constructor(t,e){super(t,"in",e),this.keys=q0("in",e)}matches(t){return this.keys.some(e=>e.isEqual(t.key))}}class OI extends Ye{constructor(t,e){super(t,"not-in",e),this.keys=q0("not-in",e)}matches(t){return!this.keys.some(e=>e.isEqual(t.key))}}function q0(i,t){var e;return(((e=t.arrayValue)===null||e===void 0?void 0:e.values)||[]).map(n=>Lt.fromName(n.referenceValue))}class FI extends Ye{constructor(t,e){super(t,"array-contains",e)}matches(t){const e=t.data.field(this.field);return Qd(e)&&Aa(e.arrayValue,this.value)}}class VI extends Ye{constructor(t,e){super(t,"in",e)}matches(t){const e=t.data.field(this.field);return e!==null&&Aa(this.value.arrayValue,e)}}class BI extends Ye{constructor(t,e){super(t,"not-in",e)}matches(t){if(Aa(this.value.arrayValue,{nullValue:"NULL_VALUE"}))return!1;const e=t.data.field(this.field);return e!==null&&e.nullValue===void 0&&!Aa(this.value.arrayValue,e)}}class kI extends Ye{constructor(t,e){super(t,"array-contains-any",e)}matches(t){const e=t.data.field(this.field);return!(!Qd(e)||!e.arrayValue.values)&&e.arrayValue.values.some(n=>Aa(this.value.arrayValue,n))}}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class zI{constructor(t,e=null,n=[],s=[],r=null,o=null,a=null){this.path=t,this.collectionGroup=e,this.orderBy=n,this.filters=s,this.limit=r,this.startAt=o,this.endAt=a,this.Pe=null}}function mg(i,t=null,e=[],n=[],s=null,r=null,o=null){return new zI(i,t,e,n,s,r,o)}function tf(i){const t=jt(i);if(t.Pe===null){let e=t.path.canonicalString();t.collectionGroup!==null&&(e+="|cg:"+t.collectionGroup),e+="|f:",e+=t.filters.map(n=>nd(n)).join(","),e+="|ob:",e+=t.orderBy.map(n=>function(r){return r.field.canonicalString()+r.dir}(n)).join(","),Dl(t.limit)||(e+="|l:",e+=t.limit),t.startAt&&(e+="|lb:",e+=t.startAt.inclusive?"b:":"a:",e+=t.startAt.position.map(n=>oo(n)).join(",")),t.endAt&&(e+="|ub:",e+=t.endAt.inclusive?"a:":"b:",e+=t.endAt.position.map(n=>oo(n)).join(",")),t.Pe=e}return t.Pe}function ef(i,t){if(i.limit!==t.limit||i.orderBy.length!==t.orderBy.length)return!1;for(let e=0;e<i.orderBy.length;e++)if(!DI(i.orderBy[e],t.orderBy[e]))return!1;if(i.filters.length!==t.filters.length)return!1;for(let e=0;e<i.filters.length;e++)if(!W0(i.filters[e],t.filters[e]))return!1;return i.collectionGroup===t.collectionGroup&&!!i.path.isEqual(t.path)&&!!pg(i.startAt,t.startAt)&&pg(i.endAt,t.endAt)}function id(i){return Lt.isDocumentKey(i.path)&&i.collectionGroup===null&&i.filters.length===0}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Nl{constructor(t,e=null,n=[],s=[],r=null,o="F",a=null,c=null){this.path=t,this.collectionGroup=e,this.explicitOrderBy=n,this.filters=s,this.limit=r,this.limitType=o,this.startAt=a,this.endAt=c,this.Te=null,this.Ie=null,this.de=null,this.startAt,this.endAt}}function HI(i,t,e,n,s,r,o,a){return new Nl(i,t,e,n,s,r,o,a)}function nf(i){return new Nl(i)}function gg(i){return i.filters.length===0&&i.limit===null&&i.startAt==null&&i.endAt==null&&(i.explicitOrderBy.length===0||i.explicitOrderBy.length===1&&i.explicitOrderBy[0].field.isKeyField())}function GI(i){return i.collectionGroup!==null}function oa(i){const t=jt(i);if(t.Te===null){t.Te=[];const e=new Set;for(const r of t.explicitOrderBy)t.Te.push(r),e.add(r.field.canonicalString());const n=t.explicitOrderBy.length>0?t.explicitOrderBy[t.explicitOrderBy.length-1].dir:"asc";(function(o){let a=new Qe(dn.comparator);return o.filters.forEach(c=>{c.getFlattenedFilters().forEach(l=>{l.isInequality()&&(a=a.add(l.field))})}),a})(t).forEach(r=>{e.has(r.canonicalString())||r.isKeyField()||t.Te.push(new _l(r,n))}),e.has(dn.keyField().canonicalString())||t.Te.push(new _l(dn.keyField(),n))}return t.Te}function pi(i){const t=jt(i);return t.Ie||(t.Ie=WI(t,oa(i))),t.Ie}function WI(i,t){if(i.limitType==="F")return mg(i.path,i.collectionGroup,t,i.filters,i.limit,i.startAt,i.endAt);{t=t.map(s=>{const r=s.dir==="desc"?"asc":"desc";return new _l(s.field,r)});const e=i.endAt?new gl(i.endAt.position,i.endAt.inclusive):null,n=i.startAt?new gl(i.startAt.position,i.startAt.inclusive):null;return mg(i.path,i.collectionGroup,t,i.filters,i.limit,e,n)}}function sd(i,t,e){return new Nl(i.path,i.collectionGroup,i.explicitOrderBy.slice(),i.filters.slice(),t,e,i.startAt,i.endAt)}function Ul(i,t){return ef(pi(i),pi(t))&&i.limitType===t.limitType}function j0(i){return`${tf(pi(i))}|lt:${i.limitType}`}function Dr(i){return`Query(target=${function(e){let n=e.path.canonicalString();return e.collectionGroup!==null&&(n+=" collectionGroup="+e.collectionGroup),e.filters.length>0&&(n+=`, filters: [${e.filters.map(s=>X0(s)).join(", ")}]`),Dl(e.limit)||(n+=", limit: "+e.limit),e.orderBy.length>0&&(n+=`, orderBy: [${e.orderBy.map(s=>function(o){return`${o.field.canonicalString()} (${o.dir})`}(s)).join(", ")}]`),e.startAt&&(n+=", startAt: ",n+=e.startAt.inclusive?"b:":"a:",n+=e.startAt.position.map(s=>oo(s)).join(",")),e.endAt&&(n+=", endAt: ",n+=e.endAt.inclusive?"a:":"b:",n+=e.endAt.position.map(s=>oo(s)).join(",")),`Target(${n})`}(pi(i))}; limitType=${i.limitType})`}function Ol(i,t){return t.isFoundDocument()&&function(n,s){const r=s.key.path;return n.collectionGroup!==null?s.key.hasCollectionId(n.collectionGroup)&&n.path.isPrefixOf(r):Lt.isDocumentKey(n.path)?n.path.isEqual(r):n.path.isImmediateParentOf(r)}(i,t)&&function(n,s){for(const r of oa(n))if(!r.field.isKeyField()&&s.data.field(r.field)===null)return!1;return!0}(i,t)&&function(n,s){for(const r of n.filters)if(!r.matches(s))return!1;return!0}(i,t)&&function(n,s){return!(n.startAt&&!function(o,a,c){const l=fg(o,a,c);return o.inclusive?l<=0:l<0}(n.startAt,oa(n),s)||n.endAt&&!function(o,a,c){const l=fg(o,a,c);return o.inclusive?l>=0:l>0}(n.endAt,oa(n),s))}(i,t)}function XI(i){return i.collectionGroup||(i.path.length%2==1?i.path.lastSegment():i.path.get(i.path.length-2))}function K0(i){return(t,e)=>{let n=!1;for(const s of oa(i)){const r=qI(s,t,e);if(r!==0)return r;n=n||s.field.isKeyField()}return 0}}function qI(i,t,e){const n=i.field.isKeyField()?Lt.comparator(t.key,e.key):function(r,o,a){const c=o.data.field(r),l=a.data.field(r);return c!==null&&l!==null?ro(c,l):Ft(42886)}(i.field,t,e);switch(i.dir){case"asc":return n;case"desc":return-1*n;default:return Ft(19790,{direction:i.dir})}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class er{constructor(t,e){this.mapKeyFn=t,this.equalsFn=e,this.inner={},this.innerSize=0}get(t){const e=this.mapKeyFn(t),n=this.inner[e];if(n!==void 0){for(const[s,r]of n)if(this.equalsFn(s,t))return r}}has(t){return this.get(t)!==void 0}set(t,e){const n=this.mapKeyFn(t),s=this.inner[n];if(s===void 0)return this.inner[n]=[[t,e]],void this.innerSize++;for(let r=0;r<s.length;r++)if(this.equalsFn(s[r][0],t))return void(s[r]=[t,e]);s.push([t,e]),this.innerSize++}delete(t){const e=this.mapKeyFn(t),n=this.inner[e];if(n===void 0)return!1;for(let s=0;s<n.length;s++)if(this.equalsFn(n[s][0],t))return n.length===1?delete this.inner[e]:n.splice(s,1),this.innerSize--,!0;return!1}forEach(t){tr(this.inner,(e,n)=>{for(const[s,r]of n)t(s,r)})}isEmpty(){return D0(this.inner)}size(){return this.innerSize}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const jI=new Oe(Lt.comparator);function Gi(){return jI}const $0=new Oe(Lt.comparator);function Ko(...i){let t=$0;for(const e of i)t=t.insert(e.key,e);return t}function Y0(i){let t=$0;return i.forEach((e,n)=>t=t.insert(e,n.overlayedDocument)),t}function Gs(){return aa()}function J0(){return aa()}function aa(){return new er(i=>i.toString(),(i,t)=>i.isEqual(t))}const KI=new Oe(Lt.comparator),$I=new Qe(Lt.comparator);function se(...i){let t=$I;for(const e of i)t=t.add(e);return t}const YI=new Qe(Zt);function JI(){return YI}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function sf(i,t){if(i.useProto3Json){if(isNaN(t))return{doubleValue:"NaN"};if(t===1/0)return{doubleValue:"Infinity"};if(t===-1/0)return{doubleValue:"-Infinity"}}return{doubleValue:fl(t)?"-0":t}}function Z0(i){return{integerValue:""+i}}function Q0(i,t){return AI(t)?Z0(t):sf(i,t)}/**
 * @license
 * Copyright 2018 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Fl{constructor(){this._=void 0}}function ZI(i,t,e){return i instanceof vl?function(s,r){const o={fields:{[U0]:{stringValue:N0},[F0]:{timestampValue:{seconds:s.seconds,nanos:s.nanoseconds}}}};return r&&Zd(r)&&(r=Ll(r)),r&&(o.fields[O0]=r),{mapValue:o}}(e,t):i instanceof Ma?ev(i,t):i instanceof wa?nv(i,t):function(s,r){const o=tv(s,r),a=_g(o)+_g(s.Ee);return ed(o)&&ed(s.Ee)?Z0(a):sf(s.serializer,a)}(i,t)}function QI(i,t,e){return i instanceof Ma?ev(i,t):i instanceof wa?nv(i,t):e}function tv(i,t){return i instanceof ba?function(n){return ed(n)||function(r){return!!r&&"doubleValue"in r}(n)}(t)?t:{integerValue:0}:null}class vl extends Fl{}class Ma extends Fl{constructor(t){super(),this.elements=t}}function ev(i,t){const e=iv(t);for(const n of i.elements)e.some(s=>xi(s,n))||e.push(n);return{arrayValue:{values:e}}}class wa extends Fl{constructor(t){super(),this.elements=t}}function nv(i,t){let e=iv(t);for(const n of i.elements)e=e.filter(s=>!xi(s,n));return{arrayValue:{values:e}}}class ba extends Fl{constructor(t,e){super(),this.serializer=t,this.Ee=e}}function _g(i){return ke(i.integerValue||i.doubleValue)}function iv(i){return Qd(i)&&i.arrayValue.values?i.arrayValue.values.slice():[]}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class tC{constructor(t,e){this.field=t,this.transform=e}}function eC(i,t){return i.field.isEqual(t.field)&&function(n,s){return n instanceof Ma&&s instanceof Ma||n instanceof wa&&s instanceof wa?so(n.elements,s.elements,xi):n instanceof ba&&s instanceof ba?xi(n.Ee,s.Ee):n instanceof vl&&s instanceof vl}(i.transform,t.transform)}class nC{constructor(t,e){this.version=t,this.transformResults=e}}class mi{constructor(t,e){this.updateTime=t,this.exists=e}static none(){return new mi}static exists(t){return new mi(void 0,t)}static updateTime(t){return new mi(t)}get isNone(){return this.updateTime===void 0&&this.exists===void 0}isEqual(t){return this.exists===t.exists&&(this.updateTime?!!t.updateTime&&this.updateTime.isEqual(t.updateTime):!t.updateTime)}}function jc(i,t){return i.updateTime!==void 0?t.isFoundDocument()&&t.version.isEqual(i.updateTime):i.exists===void 0||i.exists===t.isFoundDocument()}class Vl{}function sv(i,t){if(!i.hasLocalMutations||t&&t.fields.length===0)return null;if(t===null)return i.isNoDocument()?new rf(i.key,mi.none()):new Na(i.key,i.data,mi.none());{const e=i.data,n=Gn.empty();let s=new Qe(dn.comparator);for(let r of t.fields)if(!s.has(r)){let o=e.field(r);o===null&&r.length>1&&(r=r.popLast(),o=e.field(r)),o===null?n.delete(r):n.set(r,o),s=s.add(r)}return new nr(i.key,n,new ri(s.toArray()),mi.none())}}function iC(i,t,e){i instanceof Na?function(s,r,o){const a=s.value.clone(),c=yg(s.fieldTransforms,r,o.transformResults);a.setAll(c),r.convertToFoundDocument(o.version,a).setHasCommittedMutations()}(i,t,e):i instanceof nr?function(s,r,o){if(!jc(s.precondition,r))return void r.convertToUnknownDocument(o.version);const a=yg(s.fieldTransforms,r,o.transformResults),c=r.data;c.setAll(rv(s)),c.setAll(a),r.convertToFoundDocument(o.version,c).setHasCommittedMutations()}(i,t,e):function(s,r,o){r.convertToNoDocument(o.version).setHasCommittedMutations()}(0,t,e)}function ca(i,t,e,n){return i instanceof Na?function(r,o,a,c){if(!jc(r.precondition,o))return a;const l=r.value.clone(),h=xg(r.fieldTransforms,c,o);return l.setAll(h),o.convertToFoundDocument(o.version,l).setHasLocalMutations(),null}(i,t,e,n):i instanceof nr?function(r,o,a,c){if(!jc(r.precondition,o))return a;const l=xg(r.fieldTransforms,c,o),h=o.data;return h.setAll(rv(r)),h.setAll(l),o.convertToFoundDocument(o.version,h).setHasLocalMutations(),a===null?null:a.unionWith(r.fieldMask.fields).unionWith(r.fieldTransforms.map(d=>d.field))}(i,t,e,n):function(r,o,a){return jc(r.precondition,o)?(o.convertToNoDocument(o.version).setHasLocalMutations(),null):a}(i,t,e)}function sC(i,t){let e=null;for(const n of i.fieldTransforms){const s=t.data.field(n.field),r=tv(n.transform,s||null);r!=null&&(e===null&&(e=Gn.empty()),e.set(n.field,r))}return e||null}function vg(i,t){return i.type===t.type&&!!i.key.isEqual(t.key)&&!!i.precondition.isEqual(t.precondition)&&!!function(n,s){return n===void 0&&s===void 0||!(!n||!s)&&so(n,s,(r,o)=>eC(r,o))}(i.fieldTransforms,t.fieldTransforms)&&(i.type===0?i.value.isEqual(t.value):i.type!==1||i.data.isEqual(t.data)&&i.fieldMask.isEqual(t.fieldMask))}class Na extends Vl{constructor(t,e,n,s=[]){super(),this.key=t,this.value=e,this.precondition=n,this.fieldTransforms=s,this.type=0}getFieldMask(){return null}}class nr extends Vl{constructor(t,e,n,s,r=[]){super(),this.key=t,this.data=e,this.fieldMask=n,this.precondition=s,this.fieldTransforms=r,this.type=1}getFieldMask(){return this.fieldMask}}function rv(i){const t=new Map;return i.fieldMask.fields.forEach(e=>{if(!e.isEmpty()){const n=i.data.field(e);t.set(e,n)}}),t}function yg(i,t,e){const n=new Map;ye(i.length===e.length,32656,{Ae:e.length,Re:i.length});for(let s=0;s<e.length;s++){const r=i[s],o=r.transform,a=t.data.field(r.field);n.set(r.field,QI(o,a,e[s]))}return n}function xg(i,t,e){const n=new Map;for(const s of i){const r=s.transform,o=e.data.field(s.field);n.set(s.field,ZI(r,o,t))}return n}class rf extends Vl{constructor(t,e){super(),this.key=t,this.precondition=e,this.type=2,this.fieldTransforms=[]}getFieldMask(){return null}}class rC extends Vl{constructor(t,e){super(),this.key=t,this.precondition=e,this.type=3,this.fieldTransforms=[]}getFieldMask(){return null}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class oC{constructor(t,e,n,s){this.batchId=t,this.localWriteTime=e,this.baseMutations=n,this.mutations=s}applyToRemoteDocument(t,e){const n=e.mutationResults;for(let s=0;s<this.mutations.length;s++){const r=this.mutations[s];r.key.isEqual(t.key)&&iC(r,t,n[s])}}applyToLocalView(t,e){for(const n of this.baseMutations)n.key.isEqual(t.key)&&(e=ca(n,t,e,this.localWriteTime));for(const n of this.mutations)n.key.isEqual(t.key)&&(e=ca(n,t,e,this.localWriteTime));return e}applyToLocalDocumentSet(t,e){const n=J0();return this.mutations.forEach(s=>{const r=t.get(s.key),o=r.overlayedDocument;let a=this.applyToLocalView(o,r.mutatedFields);a=e.has(s.key)?null:a;const c=sv(o,a);c!==null&&n.set(s.key,c),o.isValidDocument()||o.convertToNoDocument(Wt.min())}),n}keys(){return this.mutations.reduce((t,e)=>t.add(e.key),se())}isEqual(t){return this.batchId===t.batchId&&so(this.mutations,t.mutations,(e,n)=>vg(e,n))&&so(this.baseMutations,t.baseMutations,(e,n)=>vg(e,n))}}class of{constructor(t,e,n,s){this.batch=t,this.commitVersion=e,this.mutationResults=n,this.docVersions=s}static from(t,e,n){ye(t.mutations.length===n.length,58842,{Ve:t.mutations.length,me:n.length});let s=function(){return KI}();const r=t.mutations;for(let o=0;o<r.length;o++)s=s.insert(r[o].key,n[o].version);return new of(t,e,n,s)}}/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class aC{constructor(t,e){this.largestBatchId=t,this.mutation=e}getKey(){return this.mutation.key}isEqual(t){return t!==null&&this.mutation===t.mutation}toString(){return`Overlay{
      largestBatchId: ${this.largestBatchId},
      mutation: ${this.mutation.toString()}
    }`}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class cC{constructor(t,e){this.count=t,this.unchangedNames=e}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */var Ge,ce;function lC(i){switch(i){case it.OK:return Ft(64938);case it.CANCELLED:case it.UNKNOWN:case it.DEADLINE_EXCEEDED:case it.RESOURCE_EXHAUSTED:case it.INTERNAL:case it.UNAVAILABLE:case it.UNAUTHENTICATED:return!1;case it.INVALID_ARGUMENT:case it.NOT_FOUND:case it.ALREADY_EXISTS:case it.PERMISSION_DENIED:case it.FAILED_PRECONDITION:case it.ABORTED:case it.OUT_OF_RANGE:case it.UNIMPLEMENTED:case it.DATA_LOSS:return!0;default:return Ft(15467,{code:i})}}function ov(i){if(i===void 0)return Hi("GRPC error has no .code"),it.UNKNOWN;switch(i){case Ge.OK:return it.OK;case Ge.CANCELLED:return it.CANCELLED;case Ge.UNKNOWN:return it.UNKNOWN;case Ge.DEADLINE_EXCEEDED:return it.DEADLINE_EXCEEDED;case Ge.RESOURCE_EXHAUSTED:return it.RESOURCE_EXHAUSTED;case Ge.INTERNAL:return it.INTERNAL;case Ge.UNAVAILABLE:return it.UNAVAILABLE;case Ge.UNAUTHENTICATED:return it.UNAUTHENTICATED;case Ge.INVALID_ARGUMENT:return it.INVALID_ARGUMENT;case Ge.NOT_FOUND:return it.NOT_FOUND;case Ge.ALREADY_EXISTS:return it.ALREADY_EXISTS;case Ge.PERMISSION_DENIED:return it.PERMISSION_DENIED;case Ge.FAILED_PRECONDITION:return it.FAILED_PRECONDITION;case Ge.ABORTED:return it.ABORTED;case Ge.OUT_OF_RANGE:return it.OUT_OF_RANGE;case Ge.UNIMPLEMENTED:return it.UNIMPLEMENTED;case Ge.DATA_LOSS:return it.DATA_LOSS;default:return Ft(39323,{code:i})}}(ce=Ge||(Ge={}))[ce.OK=0]="OK",ce[ce.CANCELLED=1]="CANCELLED",ce[ce.UNKNOWN=2]="UNKNOWN",ce[ce.INVALID_ARGUMENT=3]="INVALID_ARGUMENT",ce[ce.DEADLINE_EXCEEDED=4]="DEADLINE_EXCEEDED",ce[ce.NOT_FOUND=5]="NOT_FOUND",ce[ce.ALREADY_EXISTS=6]="ALREADY_EXISTS",ce[ce.PERMISSION_DENIED=7]="PERMISSION_DENIED",ce[ce.UNAUTHENTICATED=16]="UNAUTHENTICATED",ce[ce.RESOURCE_EXHAUSTED=8]="RESOURCE_EXHAUSTED",ce[ce.FAILED_PRECONDITION=9]="FAILED_PRECONDITION",ce[ce.ABORTED=10]="ABORTED",ce[ce.OUT_OF_RANGE=11]="OUT_OF_RANGE",ce[ce.UNIMPLEMENTED=12]="UNIMPLEMENTED",ce[ce.INTERNAL=13]="INTERNAL",ce[ce.UNAVAILABLE=14]="UNAVAILABLE",ce[ce.DATA_LOSS=15]="DATA_LOSS";/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const uC=new fs([4294967295,4294967295],0);function Eg(i){const t=R0().encode(i),e=new x0;return e.update(t),new Uint8Array(e.digest())}function Tg(i){const t=new DataView(i.buffer),e=t.getUint32(0,!0),n=t.getUint32(4,!0),s=t.getUint32(8,!0),r=t.getUint32(12,!0);return[new fs([e,n],0),new fs([s,r],0)]}class af{constructor(t,e,n){if(this.bitmap=t,this.padding=e,this.hashCount=n,e<0||e>=8)throw new $o(`Invalid padding: ${e}`);if(n<0)throw new $o(`Invalid hash count: ${n}`);if(t.length>0&&this.hashCount===0)throw new $o(`Invalid hash count: ${n}`);if(t.length===0&&e!==0)throw new $o(`Invalid padding when bitmap length is 0: ${e}`);this.fe=8*t.length-e,this.ge=fs.fromNumber(this.fe)}pe(t,e,n){let s=t.add(e.multiply(fs.fromNumber(n)));return s.compare(uC)===1&&(s=new fs([s.getBits(0),s.getBits(1)],0)),s.modulo(this.ge).toNumber()}ye(t){return!!(this.bitmap[Math.floor(t/8)]&1<<t%8)}mightContain(t){if(this.fe===0)return!1;const e=Eg(t),[n,s]=Tg(e);for(let r=0;r<this.hashCount;r++){const o=this.pe(n,s,r);if(!this.ye(o))return!1}return!0}static create(t,e,n){const s=t%8==0?0:8-t%8,r=new Uint8Array(Math.ceil(t/8)),o=new af(r,s,e);return n.forEach(a=>o.insert(a)),o}insert(t){if(this.fe===0)return;const e=Eg(t),[n,s]=Tg(e);for(let r=0;r<this.hashCount;r++){const o=this.pe(n,s,r);this.we(o)}}we(t){const e=Math.floor(t/8),n=t%8;this.bitmap[e]|=1<<n}}class $o extends Error{constructor(){super(...arguments),this.name="BloomFilterError"}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Bl{constructor(t,e,n,s,r){this.snapshotVersion=t,this.targetChanges=e,this.targetMismatches=n,this.documentUpdates=s,this.resolvedLimboDocuments=r}static createSynthesizedRemoteEventForCurrentChange(t,e,n){const s=new Map;return s.set(t,Ua.createSynthesizedTargetChangeForCurrentChange(t,e,n)),new Bl(Wt.min(),s,new Oe(Zt),Gi(),se())}}class Ua{constructor(t,e,n,s,r){this.resumeToken=t,this.current=e,this.addedDocuments=n,this.modifiedDocuments=s,this.removedDocuments=r}static createSynthesizedTargetChangeForCurrentChange(t,e,n){return new Ua(n,e,se(),se(),se())}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Kc{constructor(t,e,n,s){this.Se=t,this.removedTargetIds=e,this.key=n,this.be=s}}class av{constructor(t,e){this.targetId=t,this.De=e}}class cv{constructor(t,e,n=pn.EMPTY_BYTE_STRING,s=null){this.state=t,this.targetIds=e,this.resumeToken=n,this.cause=s}}class Sg{constructor(){this.ve=0,this.Ce=Ag(),this.Fe=pn.EMPTY_BYTE_STRING,this.Me=!1,this.xe=!0}get current(){return this.Me}get resumeToken(){return this.Fe}get Oe(){return this.ve!==0}get Ne(){return this.xe}Be(t){t.approximateByteSize()>0&&(this.xe=!0,this.Fe=t)}Le(){let t=se(),e=se(),n=se();return this.Ce.forEach((s,r)=>{switch(r){case 0:t=t.add(s);break;case 2:e=e.add(s);break;case 1:n=n.add(s);break;default:Ft(38017,{changeType:r})}}),new Ua(this.Fe,this.Me,t,e,n)}ke(){this.xe=!1,this.Ce=Ag()}qe(t,e){this.xe=!0,this.Ce=this.Ce.insert(t,e)}Qe(t){this.xe=!0,this.Ce=this.Ce.remove(t)}$e(){this.ve+=1}Ue(){this.ve-=1,ye(this.ve>=0,3241,{ve:this.ve})}Ke(){this.xe=!0,this.Me=!0}}class hC{constructor(t){this.We=t,this.Ge=new Map,this.ze=Gi(),this.je=Dc(),this.Je=Dc(),this.He=new Oe(Zt)}Ye(t){for(const e of t.Se)t.be&&t.be.isFoundDocument()?this.Ze(e,t.be):this.Xe(e,t.key,t.be);for(const e of t.removedTargetIds)this.Xe(e,t.key,t.be)}et(t){this.forEachTarget(t,e=>{const n=this.tt(e);switch(t.state){case 0:this.nt(e)&&n.Be(t.resumeToken);break;case 1:n.Ue(),n.Oe||n.ke(),n.Be(t.resumeToken);break;case 2:n.Ue(),n.Oe||this.removeTarget(e);break;case 3:this.nt(e)&&(n.Ke(),n.Be(t.resumeToken));break;case 4:this.nt(e)&&(this.rt(e),n.Be(t.resumeToken));break;default:Ft(56790,{state:t.state})}})}forEachTarget(t,e){t.targetIds.length>0?t.targetIds.forEach(e):this.Ge.forEach((n,s)=>{this.nt(s)&&e(s)})}it(t){const e=t.targetId,n=t.De.count,s=this.st(e);if(s){const r=s.target;if(id(r))if(n===0){const o=new Lt(r.path);this.Xe(e,o,Sn.newNoDocument(o,Wt.min()))}else ye(n===1,20013,{expectedCount:n});else{const o=this.ot(e);if(o!==n){const a=this._t(t),c=a?this.ut(a,t,o):1;if(c!==0){this.rt(e);const l=c===2?"TargetPurposeExistenceFilterMismatchBloom":"TargetPurposeExistenceFilterMismatch";this.He=this.He.insert(e,l)}}}}}_t(t){const e=t.De.unchangedNames;if(!e||!e.bits)return null;const{bits:{bitmap:n="",padding:s=0},hashCount:r=0}=e;let o,a;try{o=Es(n).toUint8Array()}catch(c){if(c instanceof L0)return vs("Decoding the base64 bloom filter in existence filter failed ("+c.message+"); ignoring the bloom filter and falling back to full re-query."),null;throw c}try{a=new af(o,s,r)}catch(c){return vs(c instanceof $o?"BloomFilter error: ":"Applying bloom filter failed: ",c),null}return a.fe===0?null:a}ut(t,e,n){return e.De.count===n-this.ht(t,e.targetId)?0:2}ht(t,e){const n=this.We.getRemoteKeysForTarget(e);let s=0;return n.forEach(r=>{const o=this.We.lt(),a=`projects/${o.projectId}/databases/${o.database}/documents/${r.path.canonicalString()}`;t.mightContain(a)||(this.Xe(e,r,null),s++)}),s}Pt(t){const e=new Map;this.Ge.forEach((r,o)=>{const a=this.st(o);if(a){if(r.current&&id(a.target)){const c=new Lt(a.target.path);this.Tt(c).has(o)||this.It(o,c)||this.Xe(o,c,Sn.newNoDocument(c,t))}r.Ne&&(e.set(o,r.Le()),r.ke())}});let n=se();this.Je.forEach((r,o)=>{let a=!0;o.forEachWhile(c=>{const l=this.st(c);return!l||l.purpose==="TargetPurposeLimboResolution"||(a=!1,!1)}),a&&(n=n.add(r))}),this.ze.forEach((r,o)=>o.setReadTime(t));const s=new Bl(t,e,this.He,this.ze,n);return this.ze=Gi(),this.je=Dc(),this.Je=Dc(),this.He=new Oe(Zt),s}Ze(t,e){if(!this.nt(t))return;const n=this.It(t,e.key)?2:0;this.tt(t).qe(e.key,n),this.ze=this.ze.insert(e.key,e),this.je=this.je.insert(e.key,this.Tt(e.key).add(t)),this.Je=this.Je.insert(e.key,this.dt(e.key).add(t))}Xe(t,e,n){if(!this.nt(t))return;const s=this.tt(t);this.It(t,e)?s.qe(e,1):s.Qe(e),this.Je=this.Je.insert(e,this.dt(e).delete(t)),this.Je=this.Je.insert(e,this.dt(e).add(t)),n&&(this.ze=this.ze.insert(e,n))}removeTarget(t){this.Ge.delete(t)}ot(t){const e=this.tt(t).Le();return this.We.getRemoteKeysForTarget(t).size+e.addedDocuments.size-e.removedDocuments.size}$e(t){this.tt(t).$e()}tt(t){let e=this.Ge.get(t);return e||(e=new Sg,this.Ge.set(t,e)),e}dt(t){let e=this.Je.get(t);return e||(e=new Qe(Zt),this.Je=this.Je.insert(t,e)),e}Tt(t){let e=this.je.get(t);return e||(e=new Qe(Zt),this.je=this.je.insert(t,e)),e}nt(t){const e=this.st(t)!==null;return e||xt("WatchChangeAggregator","Detected inactive target",t),e}st(t){const e=this.Ge.get(t);return e&&e.Oe?null:this.We.Et(t)}rt(t){this.Ge.set(t,new Sg),this.We.getRemoteKeysForTarget(t).forEach(e=>{this.Xe(t,e,null)})}It(t,e){return this.We.getRemoteKeysForTarget(t).has(e)}}function Dc(){return new Oe(Lt.comparator)}function Ag(){return new Oe(Lt.comparator)}const dC={asc:"ASCENDING",desc:"DESCENDING"},fC={"<":"LESS_THAN","<=":"LESS_THAN_OR_EQUAL",">":"GREATER_THAN",">=":"GREATER_THAN_OR_EQUAL","==":"EQUAL","!=":"NOT_EQUAL","array-contains":"ARRAY_CONTAINS",in:"IN","not-in":"NOT_IN","array-contains-any":"ARRAY_CONTAINS_ANY"},pC={and:"AND",or:"OR"};class mC{constructor(t,e){this.databaseId=t,this.useProto3Json=e}}function rd(i,t){return i.useProto3Json||Dl(t)?t:{value:t}}function yl(i,t){return i.useProto3Json?`${new Date(1e3*t.seconds).toISOString().replace(/\.\d*/,"").replace("Z","")}.${("000000000"+t.nanoseconds).slice(-9)}Z`:{seconds:""+t.seconds,nanos:t.nanoseconds}}function lv(i,t){return i.useProto3Json?t.toBase64():t.toUint8Array()}function gC(i,t){return yl(i,t.toTimestamp())}function gi(i){return ye(!!i,49232),Wt.fromTimestamp(function(e){const n=xs(e);return new Pe(n.seconds,n.nanos)}(i))}function cf(i,t){return od(i,t).canonicalString()}function od(i,t){const e=function(s){return new Ce(["projects",s.projectId,"databases",s.database])}(i).child("documents");return t===void 0?e:e.child(t)}function uv(i){const t=Ce.fromString(i);return ye(mv(t),10190,{key:t.toString()}),t}function ad(i,t){return cf(i.databaseId,t.path)}function Xu(i,t){const e=uv(t);if(e.get(1)!==i.databaseId.projectId)throw new Dt(it.INVALID_ARGUMENT,"Tried to deserialize key from different project: "+e.get(1)+" vs "+i.databaseId.projectId);if(e.get(3)!==i.databaseId.database)throw new Dt(it.INVALID_ARGUMENT,"Tried to deserialize key from different database: "+e.get(3)+" vs "+i.databaseId.database);return new Lt(dv(e))}function hv(i,t){return cf(i.databaseId,t)}function _C(i){const t=uv(i);return t.length===4?Ce.emptyPath():dv(t)}function cd(i){return new Ce(["projects",i.databaseId.projectId,"databases",i.databaseId.database]).canonicalString()}function dv(i){return ye(i.length>4&&i.get(4)==="documents",29091,{key:i.toString()}),i.popFirst(5)}function Mg(i,t,e){return{name:ad(i,t),fields:e.value.mapValue.fields}}function vC(i,t){let e;if("targetChange"in t){t.targetChange;const n=function(l){return l==="NO_CHANGE"?0:l==="ADD"?1:l==="REMOVE"?2:l==="CURRENT"?3:l==="RESET"?4:Ft(39313,{state:l})}(t.targetChange.targetChangeType||"NO_CHANGE"),s=t.targetChange.targetIds||[],r=function(l,h){return l.useProto3Json?(ye(h===void 0||typeof h=="string",58123),pn.fromBase64String(h||"")):(ye(h===void 0||h instanceof Buffer||h instanceof Uint8Array,16193),pn.fromUint8Array(h||new Uint8Array))}(i,t.targetChange.resumeToken),o=t.targetChange.cause,a=o&&function(l){const h=l.code===void 0?it.UNKNOWN:ov(l.code);return new Dt(h,l.message||"")}(o);e=new cv(n,s,r,a||null)}else if("documentChange"in t){t.documentChange;const n=t.documentChange;n.document,n.document.name,n.document.updateTime;const s=Xu(i,n.document.name),r=gi(n.document.updateTime),o=n.document.createTime?gi(n.document.createTime):Wt.min(),a=new Gn({mapValue:{fields:n.document.fields}}),c=Sn.newFoundDocument(s,r,o,a),l=n.targetIds||[],h=n.removedTargetIds||[];e=new Kc(l,h,c.key,c)}else if("documentDelete"in t){t.documentDelete;const n=t.documentDelete;n.document;const s=Xu(i,n.document),r=n.readTime?gi(n.readTime):Wt.min(),o=Sn.newNoDocument(s,r),a=n.removedTargetIds||[];e=new Kc([],a,o.key,o)}else if("documentRemove"in t){t.documentRemove;const n=t.documentRemove;n.document;const s=Xu(i,n.document),r=n.removedTargetIds||[];e=new Kc([],r,s,null)}else{if(!("filter"in t))return Ft(11601,{At:t});{t.filter;const n=t.filter;n.targetId;const{count:s=0,unchangedNames:r}=n,o=new cC(s,r),a=n.targetId;e=new av(a,o)}}return e}function yC(i,t){let e;if(t instanceof Na)e={update:Mg(i,t.key,t.value)};else if(t instanceof rf)e={delete:ad(i,t.key)};else if(t instanceof nr)e={update:Mg(i,t.key,t.data),updateMask:RC(t.fieldMask)};else{if(!(t instanceof rC))return Ft(16599,{Rt:t.type});e={verify:ad(i,t.key)}}return t.fieldTransforms.length>0&&(e.updateTransforms=t.fieldTransforms.map(n=>function(r,o){const a=o.transform;if(a instanceof vl)return{fieldPath:o.field.canonicalString(),setToServerValue:"REQUEST_TIME"};if(a instanceof Ma)return{fieldPath:o.field.canonicalString(),appendMissingElements:{values:a.elements}};if(a instanceof wa)return{fieldPath:o.field.canonicalString(),removeAllFromArray:{values:a.elements}};if(a instanceof ba)return{fieldPath:o.field.canonicalString(),increment:a.Ee};throw Ft(20930,{transform:o.transform})}(0,n))),t.precondition.isNone||(e.currentDocument=function(s,r){return r.updateTime!==void 0?{updateTime:gC(s,r.updateTime)}:r.exists!==void 0?{exists:r.exists}:Ft(27497)}(i,t.precondition)),e}function xC(i,t){return i&&i.length>0?(ye(t!==void 0,14353),i.map(e=>function(s,r){let o=s.updateTime?gi(s.updateTime):gi(r);return o.isEqual(Wt.min())&&(o=gi(r)),new nC(o,s.transformResults||[])}(e,t))):[]}function EC(i,t){return{documents:[hv(i,t.path)]}}function TC(i,t){const e={structuredQuery:{}},n=t.path;let s;t.collectionGroup!==null?(s=n,e.structuredQuery.from=[{collectionId:t.collectionGroup,allDescendants:!0}]):(s=n.popLast(),e.structuredQuery.from=[{collectionId:n.lastSegment()}]),e.parent=hv(i,s);const r=function(l){if(l.length!==0)return pv(Ei.create(l,"and"))}(t.filters);r&&(e.structuredQuery.where=r);const o=function(l){if(l.length!==0)return l.map(h=>function(f){return{field:Lr(f.field),direction:MC(f.dir)}}(h))}(t.orderBy);o&&(e.structuredQuery.orderBy=o);const a=rd(i,t.limit);return a!==null&&(e.structuredQuery.limit=a),t.startAt&&(e.structuredQuery.startAt=function(l){return{before:l.inclusive,values:l.position}}(t.startAt)),t.endAt&&(e.structuredQuery.endAt=function(l){return{before:!l.inclusive,values:l.position}}(t.endAt)),{Vt:e,parent:s}}function SC(i){let t=_C(i.parent);const e=i.structuredQuery,n=e.from?e.from.length:0;let s=null;if(n>0){ye(n===1,65062);const h=e.from[0];h.allDescendants?s=h.collectionId:t=t.child(h.collectionId)}let r=[];e.where&&(r=function(d){const f=fv(d);return f instanceof Ei&&G0(f)?f.getFilters():[f]}(e.where));let o=[];e.orderBy&&(o=function(d){return d.map(f=>function(v){return new _l(Nr(v.field),function(m){switch(m){case"ASCENDING":return"asc";case"DESCENDING":return"desc";default:return}}(v.direction))}(f))}(e.orderBy));let a=null;e.limit&&(a=function(d){let f;return f=typeof d=="object"?d.value:d,Dl(f)?null:f}(e.limit));let c=null;e.startAt&&(c=function(d){const f=!!d.before,p=d.values||[];return new gl(p,f)}(e.startAt));let l=null;return e.endAt&&(l=function(d){const f=!d.before,p=d.values||[];return new gl(p,f)}(e.endAt)),HI(t,s,o,r,a,"F",c,l)}function AC(i,t){const e=function(s){switch(s){case"TargetPurposeListen":return null;case"TargetPurposeExistenceFilterMismatch":return"existence-filter-mismatch";case"TargetPurposeExistenceFilterMismatchBloom":return"existence-filter-mismatch-bloom";case"TargetPurposeLimboResolution":return"limbo-document";default:return Ft(28987,{purpose:s})}}(t.purpose);return e==null?null:{"goog-listen-tags":e}}function fv(i){return i.unaryFilter!==void 0?function(e){switch(e.unaryFilter.op){case"IS_NAN":const n=Nr(e.unaryFilter.field);return Ye.create(n,"==",{doubleValue:NaN});case"IS_NULL":const s=Nr(e.unaryFilter.field);return Ye.create(s,"==",{nullValue:"NULL_VALUE"});case"IS_NOT_NAN":const r=Nr(e.unaryFilter.field);return Ye.create(r,"!=",{doubleValue:NaN});case"IS_NOT_NULL":const o=Nr(e.unaryFilter.field);return Ye.create(o,"!=",{nullValue:"NULL_VALUE"});case"OPERATOR_UNSPECIFIED":return Ft(61313);default:return Ft(60726)}}(i):i.fieldFilter!==void 0?function(e){return Ye.create(Nr(e.fieldFilter.field),function(s){switch(s){case"EQUAL":return"==";case"NOT_EQUAL":return"!=";case"GREATER_THAN":return">";case"GREATER_THAN_OR_EQUAL":return">=";case"LESS_THAN":return"<";case"LESS_THAN_OR_EQUAL":return"<=";case"ARRAY_CONTAINS":return"array-contains";case"IN":return"in";case"NOT_IN":return"not-in";case"ARRAY_CONTAINS_ANY":return"array-contains-any";case"OPERATOR_UNSPECIFIED":return Ft(58110);default:return Ft(50506)}}(e.fieldFilter.op),e.fieldFilter.value)}(i):i.compositeFilter!==void 0?function(e){return Ei.create(e.compositeFilter.filters.map(n=>fv(n)),function(s){switch(s){case"AND":return"and";case"OR":return"or";default:return Ft(1026)}}(e.compositeFilter.op))}(i):Ft(30097,{filter:i})}function MC(i){return dC[i]}function wC(i){return fC[i]}function bC(i){return pC[i]}function Lr(i){return{fieldPath:i.canonicalString()}}function Nr(i){return dn.fromServerFormat(i.fieldPath)}function pv(i){return i instanceof Ye?function(e){if(e.op==="=="){if(dg(e.value))return{unaryFilter:{field:Lr(e.field),op:"IS_NAN"}};if(hg(e.value))return{unaryFilter:{field:Lr(e.field),op:"IS_NULL"}}}else if(e.op==="!="){if(dg(e.value))return{unaryFilter:{field:Lr(e.field),op:"IS_NOT_NAN"}};if(hg(e.value))return{unaryFilter:{field:Lr(e.field),op:"IS_NOT_NULL"}}}return{fieldFilter:{field:Lr(e.field),op:wC(e.op),value:e.value}}}(i):i instanceof Ei?function(e){const n=e.getFilters().map(s=>pv(s));return n.length===1?n[0]:{compositeFilter:{op:bC(e.op),filters:n}}}(i):Ft(54877,{filter:i})}function RC(i){const t=[];return i.fields.forEach(e=>t.push(e.canonicalString())),{fieldPaths:t}}function mv(i){return i.length>=4&&i.get(0)==="projects"&&i.get(2)==="databases"}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class as{constructor(t,e,n,s,r=Wt.min(),o=Wt.min(),a=pn.EMPTY_BYTE_STRING,c=null){this.target=t,this.targetId=e,this.purpose=n,this.sequenceNumber=s,this.snapshotVersion=r,this.lastLimboFreeSnapshotVersion=o,this.resumeToken=a,this.expectedCount=c}withSequenceNumber(t){return new as(this.target,this.targetId,this.purpose,t,this.snapshotVersion,this.lastLimboFreeSnapshotVersion,this.resumeToken,this.expectedCount)}withResumeToken(t,e){return new as(this.target,this.targetId,this.purpose,this.sequenceNumber,e,this.lastLimboFreeSnapshotVersion,t,null)}withExpectedCount(t){return new as(this.target,this.targetId,this.purpose,this.sequenceNumber,this.snapshotVersion,this.lastLimboFreeSnapshotVersion,this.resumeToken,t)}withLastLimboFreeSnapshotVersion(t){return new as(this.target,this.targetId,this.purpose,this.sequenceNumber,this.snapshotVersion,t,this.resumeToken,this.expectedCount)}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class IC{constructor(t){this.gt=t}}function CC(i){const t=SC({parent:i.parent,structuredQuery:i.structuredQuery});return i.limitType==="LAST"?sd(t,t.limit,"L"):t}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class PC{constructor(){this.Dn=new DC}addToCollectionParentIndex(t,e){return this.Dn.add(e),tt.resolve()}getCollectionParents(t,e){return tt.resolve(this.Dn.getEntries(e))}addFieldIndex(t,e){return tt.resolve()}deleteFieldIndex(t,e){return tt.resolve()}deleteAllFieldIndexes(t){return tt.resolve()}createTargetIndexes(t,e){return tt.resolve()}getDocumentsMatchingTarget(t,e){return tt.resolve(null)}getIndexType(t,e){return tt.resolve(0)}getFieldIndexes(t,e){return tt.resolve([])}getNextCollectionGroupToUpdate(t){return tt.resolve(null)}getMinOffset(t,e){return tt.resolve(ys.min())}getMinOffsetFromCollectionGroup(t,e){return tt.resolve(ys.min())}updateCollectionGroup(t,e,n){return tt.resolve()}updateIndexEntries(t,e){return tt.resolve()}}class DC{constructor(){this.index={}}add(t){const e=t.lastSegment(),n=t.popLast(),s=this.index[e]||new Qe(Ce.comparator),r=!s.has(n);return this.index[e]=s.add(n),r}has(t){const e=t.lastSegment(),n=t.popLast(),s=this.index[e];return s&&s.has(n)}getEntries(t){return(this.index[t]||new Qe(Ce.comparator)).toArray()}}/**
 * @license
 * Copyright 2018 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const wg={didRun:!1,sequenceNumbersCollected:0,targetsRemoved:0,documentsRemoved:0},gv=41943040;class Cn{static withCacheSize(t){return new Cn(t,Cn.DEFAULT_COLLECTION_PERCENTILE,Cn.DEFAULT_MAX_SEQUENCE_NUMBERS_TO_COLLECT)}constructor(t,e,n){this.cacheSizeCollectionThreshold=t,this.percentileToCollect=e,this.maximumSequenceNumbersToCollect=n}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */Cn.DEFAULT_COLLECTION_PERCENTILE=10,Cn.DEFAULT_MAX_SEQUENCE_NUMBERS_TO_COLLECT=1e3,Cn.DEFAULT=new Cn(gv,Cn.DEFAULT_COLLECTION_PERCENTILE,Cn.DEFAULT_MAX_SEQUENCE_NUMBERS_TO_COLLECT),Cn.DISABLED=new Cn(-1,0,0);/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class ao{constructor(t){this._r=t}next(){return this._r+=2,this._r}static ar(){return new ao(0)}static ur(){return new ao(-1)}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const bg="LruGarbageCollector",LC=1048576;function Rg([i,t],[e,n]){const s=Zt(i,e);return s===0?Zt(t,n):s}class NC{constructor(t){this.Tr=t,this.buffer=new Qe(Rg),this.Ir=0}dr(){return++this.Ir}Er(t){const e=[t,this.dr()];if(this.buffer.size<this.Tr)this.buffer=this.buffer.add(e);else{const n=this.buffer.last();Rg(e,n)<0&&(this.buffer=this.buffer.delete(n).add(e))}}get maxValue(){return this.buffer.last()[0]}}class UC{constructor(t,e,n){this.garbageCollector=t,this.asyncQueue=e,this.localStore=n,this.Ar=null}start(){this.garbageCollector.params.cacheSizeCollectionThreshold!==-1&&this.Rr(6e4)}stop(){this.Ar&&(this.Ar.cancel(),this.Ar=null)}get started(){return this.Ar!==null}Rr(t){xt(bg,`Garbage collection scheduled in ${t}ms`),this.Ar=this.asyncQueue.enqueueAfterDelay("lru_garbage_collection",t,async()=>{this.Ar=null;try{await this.localStore.collectGarbage(this.garbageCollector)}catch(e){_o(e)?xt(bg,"Ignoring IndexedDB error during garbage collection: ",e):await go(e)}await this.Rr(3e5)})}}class OC{constructor(t,e){this.Vr=t,this.params=e}calculateTargetCount(t,e){return this.Vr.mr(t).next(n=>Math.floor(e/100*n))}nthSequenceNumber(t,e){if(e===0)return tt.resolve(Pl.ue);const n=new NC(e);return this.Vr.forEachTarget(t,s=>n.Er(s.sequenceNumber)).next(()=>this.Vr.gr(t,s=>n.Er(s))).next(()=>n.maxValue)}removeTargets(t,e,n){return this.Vr.removeTargets(t,e,n)}removeOrphanedDocuments(t,e){return this.Vr.removeOrphanedDocuments(t,e)}collect(t,e){return this.params.cacheSizeCollectionThreshold===-1?(xt("LruGarbageCollector","Garbage collection skipped; disabled"),tt.resolve(wg)):this.getCacheSize(t).next(n=>n<this.params.cacheSizeCollectionThreshold?(xt("LruGarbageCollector",`Garbage collection skipped; Cache size ${n} is lower than threshold ${this.params.cacheSizeCollectionThreshold}`),wg):this.pr(t,e))}getCacheSize(t){return this.Vr.getCacheSize(t)}pr(t,e){let n,s,r,o,a,c,l;const h=Date.now();return this.calculateTargetCount(t,this.params.percentileToCollect).next(d=>(d>this.params.maximumSequenceNumbersToCollect?(xt("LruGarbageCollector",`Capping sequence numbers to collect down to the maximum of ${this.params.maximumSequenceNumbersToCollect} from ${d}`),s=this.params.maximumSequenceNumbersToCollect):s=d,o=Date.now(),this.nthSequenceNumber(t,s))).next(d=>(n=d,a=Date.now(),this.removeTargets(t,n,e))).next(d=>(r=d,c=Date.now(),this.removeOrphanedDocuments(t,n))).next(d=>(l=Date.now(),Pr()<=le.DEBUG&&xt("LruGarbageCollector",`LRU Garbage Collection
	Counted targets in ${o-h}ms
	Determined least recently used ${s} in `+(a-o)+`ms
	Removed ${r} targets in `+(c-a)+`ms
	Removed ${d} documents in `+(l-c)+`ms
Total Duration: ${l-h}ms`),tt.resolve({didRun:!0,sequenceNumbersCollected:s,targetsRemoved:r,documentsRemoved:d})))}}function FC(i,t){return new OC(i,t)}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class VC{constructor(){this.changes=new er(t=>t.toString(),(t,e)=>t.isEqual(e)),this.changesApplied=!1}addEntry(t){this.assertNotApplied(),this.changes.set(t.key,t)}removeEntry(t,e){this.assertNotApplied(),this.changes.set(t,Sn.newInvalidDocument(t).setReadTime(e))}getEntry(t,e){this.assertNotApplied();const n=this.changes.get(e);return n!==void 0?tt.resolve(n):this.getFromCache(t,e)}getEntries(t,e){return this.getAllFromCache(t,e)}apply(t){return this.assertNotApplied(),this.changesApplied=!0,this.applyChanges(t)}assertNotApplied(){}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *//**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class BC{constructor(t,e){this.overlayedDocument=t,this.mutatedFields=e}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class kC{constructor(t,e,n,s){this.remoteDocumentCache=t,this.mutationQueue=e,this.documentOverlayCache=n,this.indexManager=s}getDocument(t,e){let n=null;return this.documentOverlayCache.getOverlay(t,e).next(s=>(n=s,this.remoteDocumentCache.getEntry(t,e))).next(s=>(n!==null&&ca(n.mutation,s,ri.empty(),Pe.now()),s))}getDocuments(t,e){return this.remoteDocumentCache.getEntries(t,e).next(n=>this.getLocalViewOfDocuments(t,n,se()).next(()=>n))}getLocalViewOfDocuments(t,e,n=se()){const s=Gs();return this.populateOverlays(t,s,e).next(()=>this.computeViews(t,e,s,n).next(r=>{let o=Ko();return r.forEach((a,c)=>{o=o.insert(a,c.overlayedDocument)}),o}))}getOverlayedDocuments(t,e){const n=Gs();return this.populateOverlays(t,n,e).next(()=>this.computeViews(t,e,n,se()))}populateOverlays(t,e,n){const s=[];return n.forEach(r=>{e.has(r)||s.push(r)}),this.documentOverlayCache.getOverlays(t,s).next(r=>{r.forEach((o,a)=>{e.set(o,a)})})}computeViews(t,e,n,s){let r=Gi();const o=aa(),a=function(){return aa()}();return e.forEach((c,l)=>{const h=n.get(l.key);s.has(l.key)&&(h===void 0||h.mutation instanceof nr)?r=r.insert(l.key,l):h!==void 0?(o.set(l.key,h.mutation.getFieldMask()),ca(h.mutation,l,h.mutation.getFieldMask(),Pe.now())):o.set(l.key,ri.empty())}),this.recalculateAndSaveOverlays(t,r).next(c=>(c.forEach((l,h)=>o.set(l,h)),e.forEach((l,h)=>{var d;return a.set(l,new BC(h,(d=o.get(l))!==null&&d!==void 0?d:null))}),a))}recalculateAndSaveOverlays(t,e){const n=aa();let s=new Oe((o,a)=>o-a),r=se();return this.mutationQueue.getAllMutationBatchesAffectingDocumentKeys(t,e).next(o=>{for(const a of o)a.keys().forEach(c=>{const l=e.get(c);if(l===null)return;let h=n.get(c)||ri.empty();h=a.applyToLocalView(l,h),n.set(c,h);const d=(s.get(a.batchId)||se()).add(c);s=s.insert(a.batchId,d)})}).next(()=>{const o=[],a=s.getReverseIterator();for(;a.hasNext();){const c=a.getNext(),l=c.key,h=c.value,d=J0();h.forEach(f=>{if(!r.has(f)){const p=sv(e.get(f),n.get(f));p!==null&&d.set(f,p),r=r.add(f)}}),o.push(this.documentOverlayCache.saveOverlays(t,l,d))}return tt.waitFor(o)}).next(()=>n)}recalculateAndSaveOverlaysForDocumentKeys(t,e){return this.remoteDocumentCache.getEntries(t,e).next(n=>this.recalculateAndSaveOverlays(t,n))}getDocumentsMatchingQuery(t,e,n,s){return function(o){return Lt.isDocumentKey(o.path)&&o.collectionGroup===null&&o.filters.length===0}(e)?this.getDocumentsMatchingDocumentQuery(t,e.path):GI(e)?this.getDocumentsMatchingCollectionGroupQuery(t,e,n,s):this.getDocumentsMatchingCollectionQuery(t,e,n,s)}getNextDocuments(t,e,n,s){return this.remoteDocumentCache.getAllFromCollectionGroup(t,e,n,s).next(r=>{const o=s-r.size>0?this.documentOverlayCache.getOverlaysForCollectionGroup(t,e,n.largestBatchId,s-r.size):tt.resolve(Gs());let a=Ea,c=r;return o.next(l=>tt.forEach(l,(h,d)=>(a<d.largestBatchId&&(a=d.largestBatchId),r.get(h)?tt.resolve():this.remoteDocumentCache.getEntry(t,h).next(f=>{c=c.insert(h,f)}))).next(()=>this.populateOverlays(t,l,r)).next(()=>this.computeViews(t,c,l,se())).next(h=>({batchId:a,changes:Y0(h)})))})}getDocumentsMatchingDocumentQuery(t,e){return this.getDocument(t,new Lt(e)).next(n=>{let s=Ko();return n.isFoundDocument()&&(s=s.insert(n.key,n)),s})}getDocumentsMatchingCollectionGroupQuery(t,e,n,s){const r=e.collectionGroup;let o=Ko();return this.indexManager.getCollectionParents(t,r).next(a=>tt.forEach(a,c=>{const l=function(d,f){return new Nl(f,null,d.explicitOrderBy.slice(),d.filters.slice(),d.limit,d.limitType,d.startAt,d.endAt)}(e,c.child(r));return this.getDocumentsMatchingCollectionQuery(t,l,n,s).next(h=>{h.forEach((d,f)=>{o=o.insert(d,f)})})}).next(()=>o))}getDocumentsMatchingCollectionQuery(t,e,n,s){let r;return this.documentOverlayCache.getOverlaysForCollection(t,e.path,n.largestBatchId).next(o=>(r=o,this.remoteDocumentCache.getDocumentsMatchingQuery(t,e,n,r,s))).next(o=>{r.forEach((c,l)=>{const h=l.getKey();o.get(h)===null&&(o=o.insert(h,Sn.newInvalidDocument(h)))});let a=Ko();return o.forEach((c,l)=>{const h=r.get(c);h!==void 0&&ca(h.mutation,l,ri.empty(),Pe.now()),Ol(e,l)&&(a=a.insert(c,l))}),a})}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class zC{constructor(t){this.serializer=t,this.Br=new Map,this.Lr=new Map}getBundleMetadata(t,e){return tt.resolve(this.Br.get(e))}saveBundleMetadata(t,e){return this.Br.set(e.id,function(s){return{id:s.id,version:s.version,createTime:gi(s.createTime)}}(e)),tt.resolve()}getNamedQuery(t,e){return tt.resolve(this.Lr.get(e))}saveNamedQuery(t,e){return this.Lr.set(e.name,function(s){return{name:s.name,query:CC(s.bundledQuery),readTime:gi(s.readTime)}}(e)),tt.resolve()}}/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class HC{constructor(){this.overlays=new Oe(Lt.comparator),this.kr=new Map}getOverlay(t,e){return tt.resolve(this.overlays.get(e))}getOverlays(t,e){const n=Gs();return tt.forEach(e,s=>this.getOverlay(t,s).next(r=>{r!==null&&n.set(s,r)})).next(()=>n)}saveOverlays(t,e,n){return n.forEach((s,r)=>{this.wt(t,e,r)}),tt.resolve()}removeOverlaysForBatchId(t,e,n){const s=this.kr.get(n);return s!==void 0&&(s.forEach(r=>this.overlays=this.overlays.remove(r)),this.kr.delete(n)),tt.resolve()}getOverlaysForCollection(t,e,n){const s=Gs(),r=e.length+1,o=new Lt(e.child("")),a=this.overlays.getIteratorFrom(o);for(;a.hasNext();){const c=a.getNext().value,l=c.getKey();if(!e.isPrefixOf(l.path))break;l.path.length===r&&c.largestBatchId>n&&s.set(c.getKey(),c)}return tt.resolve(s)}getOverlaysForCollectionGroup(t,e,n,s){let r=new Oe((l,h)=>l-h);const o=this.overlays.getIterator();for(;o.hasNext();){const l=o.getNext().value;if(l.getKey().getCollectionGroup()===e&&l.largestBatchId>n){let h=r.get(l.largestBatchId);h===null&&(h=Gs(),r=r.insert(l.largestBatchId,h)),h.set(l.getKey(),l)}}const a=Gs(),c=r.getIterator();for(;c.hasNext()&&(c.getNext().value.forEach((l,h)=>a.set(l,h)),!(a.size()>=s)););return tt.resolve(a)}wt(t,e,n){const s=this.overlays.get(n.key);if(s!==null){const o=this.kr.get(s.largestBatchId).delete(n.key);this.kr.set(s.largestBatchId,o)}this.overlays=this.overlays.insert(n.key,new aC(e,n));let r=this.kr.get(e);r===void 0&&(r=se(),this.kr.set(e,r)),this.kr.set(e,r.add(n.key))}}/**
 * @license
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class GC{constructor(){this.sessionToken=pn.EMPTY_BYTE_STRING}getSessionToken(t){return tt.resolve(this.sessionToken)}setSessionToken(t,e){return this.sessionToken=e,tt.resolve()}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class lf{constructor(){this.qr=new Qe(rn.Qr),this.$r=new Qe(rn.Ur)}isEmpty(){return this.qr.isEmpty()}addReference(t,e){const n=new rn(t,e);this.qr=this.qr.add(n),this.$r=this.$r.add(n)}Kr(t,e){t.forEach(n=>this.addReference(n,e))}removeReference(t,e){this.Wr(new rn(t,e))}Gr(t,e){t.forEach(n=>this.removeReference(n,e))}zr(t){const e=new Lt(new Ce([])),n=new rn(e,t),s=new rn(e,t+1),r=[];return this.$r.forEachInRange([n,s],o=>{this.Wr(o),r.push(o.key)}),r}jr(){this.qr.forEach(t=>this.Wr(t))}Wr(t){this.qr=this.qr.delete(t),this.$r=this.$r.delete(t)}Jr(t){const e=new Lt(new Ce([])),n=new rn(e,t),s=new rn(e,t+1);let r=se();return this.$r.forEachInRange([n,s],o=>{r=r.add(o.key)}),r}containsKey(t){const e=new rn(t,0),n=this.qr.firstAfterOrEqual(e);return n!==null&&t.isEqual(n.key)}}class rn{constructor(t,e){this.key=t,this.Hr=e}static Qr(t,e){return Lt.comparator(t.key,e.key)||Zt(t.Hr,e.Hr)}static Ur(t,e){return Zt(t.Hr,e.Hr)||Lt.comparator(t.key,e.key)}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class WC{constructor(t,e){this.indexManager=t,this.referenceDelegate=e,this.mutationQueue=[],this.er=1,this.Yr=new Qe(rn.Qr)}checkEmpty(t){return tt.resolve(this.mutationQueue.length===0)}addMutationBatch(t,e,n,s){const r=this.er;this.er++,this.mutationQueue.length>0&&this.mutationQueue[this.mutationQueue.length-1];const o=new oC(r,e,n,s);this.mutationQueue.push(o);for(const a of s)this.Yr=this.Yr.add(new rn(a.key,r)),this.indexManager.addToCollectionParentIndex(t,a.key.path.popLast());return tt.resolve(o)}lookupMutationBatch(t,e){return tt.resolve(this.Zr(e))}getNextMutationBatchAfterBatchId(t,e){const n=e+1,s=this.Xr(n),r=s<0?0:s;return tt.resolve(this.mutationQueue.length>r?this.mutationQueue[r]:null)}getHighestUnacknowledgedBatchId(){return tt.resolve(this.mutationQueue.length===0?Jd:this.er-1)}getAllMutationBatches(t){return tt.resolve(this.mutationQueue.slice())}getAllMutationBatchesAffectingDocumentKey(t,e){const n=new rn(e,0),s=new rn(e,Number.POSITIVE_INFINITY),r=[];return this.Yr.forEachInRange([n,s],o=>{const a=this.Zr(o.Hr);r.push(a)}),tt.resolve(r)}getAllMutationBatchesAffectingDocumentKeys(t,e){let n=new Qe(Zt);return e.forEach(s=>{const r=new rn(s,0),o=new rn(s,Number.POSITIVE_INFINITY);this.Yr.forEachInRange([r,o],a=>{n=n.add(a.Hr)})}),tt.resolve(this.ei(n))}getAllMutationBatchesAffectingQuery(t,e){const n=e.path,s=n.length+1;let r=n;Lt.isDocumentKey(r)||(r=r.child(""));const o=new rn(new Lt(r),0);let a=new Qe(Zt);return this.Yr.forEachWhile(c=>{const l=c.key.path;return!!n.isPrefixOf(l)&&(l.length===s&&(a=a.add(c.Hr)),!0)},o),tt.resolve(this.ei(a))}ei(t){const e=[];return t.forEach(n=>{const s=this.Zr(n);s!==null&&e.push(s)}),e}removeMutationBatch(t,e){ye(this.ti(e.batchId,"removed")===0,55003),this.mutationQueue.shift();let n=this.Yr;return tt.forEach(e.mutations,s=>{const r=new rn(s.key,e.batchId);return n=n.delete(r),this.referenceDelegate.markPotentiallyOrphaned(t,s.key)}).next(()=>{this.Yr=n})}rr(t){}containsKey(t,e){const n=new rn(e,0),s=this.Yr.firstAfterOrEqual(n);return tt.resolve(e.isEqual(s&&s.key))}performConsistencyCheck(t){return this.mutationQueue.length,tt.resolve()}ti(t,e){return this.Xr(t)}Xr(t){return this.mutationQueue.length===0?0:t-this.mutationQueue[0].batchId}Zr(t){const e=this.Xr(t);return e<0||e>=this.mutationQueue.length?null:this.mutationQueue[e]}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class XC{constructor(t){this.ni=t,this.docs=function(){return new Oe(Lt.comparator)}(),this.size=0}setIndexManager(t){this.indexManager=t}addEntry(t,e){const n=e.key,s=this.docs.get(n),r=s?s.size:0,o=this.ni(e);return this.docs=this.docs.insert(n,{document:e.mutableCopy(),size:o}),this.size+=o-r,this.indexManager.addToCollectionParentIndex(t,n.path.popLast())}removeEntry(t){const e=this.docs.get(t);e&&(this.docs=this.docs.remove(t),this.size-=e.size)}getEntry(t,e){const n=this.docs.get(e);return tt.resolve(n?n.document.mutableCopy():Sn.newInvalidDocument(e))}getEntries(t,e){let n=Gi();return e.forEach(s=>{const r=this.docs.get(s);n=n.insert(s,r?r.document.mutableCopy():Sn.newInvalidDocument(s))}),tt.resolve(n)}getDocumentsMatchingQuery(t,e,n,s){let r=Gi();const o=e.path,a=new Lt(o.child("__id-9223372036854775808__")),c=this.docs.getIteratorFrom(a);for(;c.hasNext();){const{key:l,value:{document:h}}=c.getNext();if(!o.isPrefixOf(l.path))break;l.path.length>o.length+1||xI(yI(h),n)<=0||(s.has(h.key)||Ol(e,h))&&(r=r.insert(h.key,h.mutableCopy()))}return tt.resolve(r)}getAllFromCollectionGroup(t,e,n,s){Ft(9500)}ri(t,e){return tt.forEach(this.docs,n=>e(n))}newChangeBuffer(t){return new qC(this)}getSize(t){return tt.resolve(this.size)}}class qC extends VC{constructor(t){super(),this.Or=t}applyChanges(t){const e=[];return this.changes.forEach((n,s)=>{s.isValidDocument()?e.push(this.Or.addEntry(t,s)):this.Or.removeEntry(n)}),tt.waitFor(e)}getFromCache(t,e){return this.Or.getEntry(t,e)}getAllFromCache(t,e){return this.Or.getEntries(t,e)}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class jC{constructor(t){this.persistence=t,this.ii=new er(e=>tf(e),ef),this.lastRemoteSnapshotVersion=Wt.min(),this.highestTargetId=0,this.si=0,this.oi=new lf,this.targetCount=0,this._i=ao.ar()}forEachTarget(t,e){return this.ii.forEach((n,s)=>e(s)),tt.resolve()}getLastRemoteSnapshotVersion(t){return tt.resolve(this.lastRemoteSnapshotVersion)}getHighestSequenceNumber(t){return tt.resolve(this.si)}allocateTargetId(t){return this.highestTargetId=this._i.next(),tt.resolve(this.highestTargetId)}setTargetsMetadata(t,e,n){return n&&(this.lastRemoteSnapshotVersion=n),e>this.si&&(this.si=e),tt.resolve()}hr(t){this.ii.set(t.target,t);const e=t.targetId;e>this.highestTargetId&&(this._i=new ao(e),this.highestTargetId=e),t.sequenceNumber>this.si&&(this.si=t.sequenceNumber)}addTargetData(t,e){return this.hr(e),this.targetCount+=1,tt.resolve()}updateTargetData(t,e){return this.hr(e),tt.resolve()}removeTargetData(t,e){return this.ii.delete(e.target),this.oi.zr(e.targetId),this.targetCount-=1,tt.resolve()}removeTargets(t,e,n){let s=0;const r=[];return this.ii.forEach((o,a)=>{a.sequenceNumber<=e&&n.get(a.targetId)===null&&(this.ii.delete(o),r.push(this.removeMatchingKeysForTargetId(t,a.targetId)),s++)}),tt.waitFor(r).next(()=>s)}getTargetCount(t){return tt.resolve(this.targetCount)}getTargetData(t,e){const n=this.ii.get(e)||null;return tt.resolve(n)}addMatchingKeys(t,e,n){return this.oi.Kr(e,n),tt.resolve()}removeMatchingKeys(t,e,n){this.oi.Gr(e,n);const s=this.persistence.referenceDelegate,r=[];return s&&e.forEach(o=>{r.push(s.markPotentiallyOrphaned(t,o))}),tt.waitFor(r)}removeMatchingKeysForTargetId(t,e){return this.oi.zr(e),tt.resolve()}getMatchingKeysForTargetId(t,e){const n=this.oi.Jr(e);return tt.resolve(n)}containsKey(t,e){return tt.resolve(this.oi.containsKey(e))}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class _v{constructor(t,e){this.ai={},this.overlays={},this.ui=new Pl(0),this.ci=!1,this.ci=!0,this.li=new GC,this.referenceDelegate=t(this),this.hi=new jC(this),this.indexManager=new PC,this.remoteDocumentCache=function(s){return new XC(s)}(n=>this.referenceDelegate.Pi(n)),this.serializer=new IC(e),this.Ti=new zC(this.serializer)}start(){return Promise.resolve()}shutdown(){return this.ci=!1,Promise.resolve()}get started(){return this.ci}setDatabaseDeletedListener(){}setNetworkEnabled(){}getIndexManager(t){return this.indexManager}getDocumentOverlayCache(t){let e=this.overlays[t.toKey()];return e||(e=new HC,this.overlays[t.toKey()]=e),e}getMutationQueue(t,e){let n=this.ai[t.toKey()];return n||(n=new WC(e,this.referenceDelegate),this.ai[t.toKey()]=n),n}getGlobalsCache(){return this.li}getTargetCache(){return this.hi}getRemoteDocumentCache(){return this.remoteDocumentCache}getBundleCache(){return this.Ti}runTransaction(t,e,n){xt("MemoryPersistence","Starting transaction:",t);const s=new KC(this.ui.next());return this.referenceDelegate.Ii(),n(s).next(r=>this.referenceDelegate.di(s).next(()=>r)).toPromise().then(r=>(s.raiseOnCommittedEvent(),r))}Ei(t,e){return tt.or(Object.values(this.ai).map(n=>()=>n.containsKey(t,e)))}}class KC extends TI{constructor(t){super(),this.currentSequenceNumber=t}}class uf{constructor(t){this.persistence=t,this.Ai=new lf,this.Ri=null}static Vi(t){return new uf(t)}get mi(){if(this.Ri)return this.Ri;throw Ft(60996)}addReference(t,e,n){return this.Ai.addReference(n,e),this.mi.delete(n.toString()),tt.resolve()}removeReference(t,e,n){return this.Ai.removeReference(n,e),this.mi.add(n.toString()),tt.resolve()}markPotentiallyOrphaned(t,e){return this.mi.add(e.toString()),tt.resolve()}removeTarget(t,e){this.Ai.zr(e.targetId).forEach(s=>this.mi.add(s.toString()));const n=this.persistence.getTargetCache();return n.getMatchingKeysForTargetId(t,e.targetId).next(s=>{s.forEach(r=>this.mi.add(r.toString()))}).next(()=>n.removeTargetData(t,e))}Ii(){this.Ri=new Set}di(t){const e=this.persistence.getRemoteDocumentCache().newChangeBuffer();return tt.forEach(this.mi,n=>{const s=Lt.fromPath(n);return this.fi(t,s).next(r=>{r||e.removeEntry(s,Wt.min())})}).next(()=>(this.Ri=null,e.apply(t)))}updateLimboDocument(t,e){return this.fi(t,e).next(n=>{n?this.mi.delete(e.toString()):this.mi.add(e.toString())})}Pi(t){return 0}fi(t,e){return tt.or([()=>tt.resolve(this.Ai.containsKey(e)),()=>this.persistence.getTargetCache().containsKey(t,e),()=>this.persistence.Ei(t,e)])}}class xl{constructor(t,e){this.persistence=t,this.gi=new er(n=>MI(n.path),(n,s)=>n.isEqual(s)),this.garbageCollector=FC(this,e)}static Vi(t,e){return new xl(t,e)}Ii(){}di(t){return tt.resolve()}forEachTarget(t,e){return this.persistence.getTargetCache().forEachTarget(t,e)}mr(t){const e=this.yr(t);return this.persistence.getTargetCache().getTargetCount(t).next(n=>e.next(s=>n+s))}yr(t){let e=0;return this.gr(t,n=>{e++}).next(()=>e)}gr(t,e){return tt.forEach(this.gi,(n,s)=>this.Sr(t,n,s).next(r=>r?tt.resolve():e(s)))}removeTargets(t,e,n){return this.persistence.getTargetCache().removeTargets(t,e,n)}removeOrphanedDocuments(t,e){let n=0;const s=this.persistence.getRemoteDocumentCache(),r=s.newChangeBuffer();return s.ri(t,o=>this.Sr(t,o,e).next(a=>{a||(n++,r.removeEntry(o,Wt.min()))})).next(()=>r.apply(t)).next(()=>n)}markPotentiallyOrphaned(t,e){return this.gi.set(e,t.currentSequenceNumber),tt.resolve()}removeTarget(t,e){const n=e.withSequenceNumber(t.currentSequenceNumber);return this.persistence.getTargetCache().updateTargetData(t,n)}addReference(t,e,n){return this.gi.set(n,t.currentSequenceNumber),tt.resolve()}removeReference(t,e,n){return this.gi.set(n,t.currentSequenceNumber),tt.resolve()}updateLimboDocument(t,e){return this.gi.set(e,t.currentSequenceNumber),tt.resolve()}Pi(t){let e=t.key.toString().length;return t.isFoundDocument()&&(e+=Xc(t.data.value)),e}Sr(t,e,n){return tt.or([()=>this.persistence.Ei(t,e),()=>this.persistence.getTargetCache().containsKey(t,e),()=>{const s=this.gi.get(e);return tt.resolve(s!==void 0&&s>n)}])}getCacheSize(t){return this.persistence.getRemoteDocumentCache().getSize(t)}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class hf{constructor(t,e,n,s){this.targetId=t,this.fromCache=e,this.Is=n,this.ds=s}static Es(t,e){let n=se(),s=se();for(const r of e.docChanges)switch(r.type){case 0:n=n.add(r.doc.key);break;case 1:s=s.add(r.doc.key)}return new hf(t,e.fromCache,n,s)}}/**
 * @license
 * Copyright 2023 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class $C{constructor(){this._documentReadCount=0}get documentReadCount(){return this._documentReadCount}incrementDocumentReadCount(t){this._documentReadCount+=t}}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class YC{constructor(){this.As=!1,this.Rs=!1,this.Vs=100,this.fs=function(){return W1()?8:SI(H1())>0?6:4}()}initialize(t,e){this.gs=t,this.indexManager=e,this.As=!0}getDocumentsMatchingQuery(t,e,n,s){const r={result:null};return this.ps(t,e).next(o=>{r.result=o}).next(()=>{if(!r.result)return this.ys(t,e,s,n).next(o=>{r.result=o})}).next(()=>{if(r.result)return;const o=new $C;return this.ws(t,e,o).next(a=>{if(r.result=a,this.Rs)return this.Ss(t,e,o,a.size)})}).next(()=>r.result)}Ss(t,e,n,s){return n.documentReadCount<this.Vs?(Pr()<=le.DEBUG&&xt("QueryEngine","SDK will not create cache indexes for query:",Dr(e),"since it only creates cache indexes for collection contains","more than or equal to",this.Vs,"documents"),tt.resolve()):(Pr()<=le.DEBUG&&xt("QueryEngine","Query:",Dr(e),"scans",n.documentReadCount,"local documents and returns",s,"documents as results."),n.documentReadCount>this.fs*s?(Pr()<=le.DEBUG&&xt("QueryEngine","The SDK decides to create cache indexes for query:",Dr(e),"as using cache indexes may help improve performance."),this.indexManager.createTargetIndexes(t,pi(e))):tt.resolve())}ps(t,e){if(gg(e))return tt.resolve(null);let n=pi(e);return this.indexManager.getIndexType(t,n).next(s=>s===0?null:(e.limit!==null&&s===1&&(e=sd(e,null,"F"),n=pi(e)),this.indexManager.getDocumentsMatchingTarget(t,n).next(r=>{const o=se(...r);return this.gs.getDocuments(t,o).next(a=>this.indexManager.getMinOffset(t,n).next(c=>{const l=this.bs(e,a);return this.Ds(e,l,o,c.readTime)?this.ps(t,sd(e,null,"F")):this.vs(t,l,e,c)}))})))}ys(t,e,n,s){return gg(e)||s.isEqual(Wt.min())?tt.resolve(null):this.gs.getDocuments(t,n).next(r=>{const o=this.bs(e,r);return this.Ds(e,o,n,s)?tt.resolve(null):(Pr()<=le.DEBUG&&xt("QueryEngine","Re-using previous result from %s to execute query: %s",s.toString(),Dr(e)),this.vs(t,o,e,vI(s,Ea)).next(a=>a))})}bs(t,e){let n=new Qe(K0(t));return e.forEach((s,r)=>{Ol(t,r)&&(n=n.add(r))}),n}Ds(t,e,n,s){if(t.limit===null)return!1;if(n.size!==e.size)return!0;const r=t.limitType==="F"?e.last():e.first();return!!r&&(r.hasPendingWrites||r.version.compareTo(s)>0)}ws(t,e,n){return Pr()<=le.DEBUG&&xt("QueryEngine","Using full collection scan to execute query:",Dr(e)),this.gs.getDocumentsMatchingQuery(t,e,ys.min(),n)}vs(t,e,n,s){return this.gs.getDocumentsMatchingQuery(t,n,s).next(r=>(e.forEach(o=>{r=r.insert(o.key,o)}),r))}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const df="LocalStore",JC=3e8;class ZC{constructor(t,e,n,s){this.persistence=t,this.Cs=e,this.serializer=s,this.Fs=new Oe(Zt),this.Ms=new er(r=>tf(r),ef),this.xs=new Map,this.Os=t.getRemoteDocumentCache(),this.hi=t.getTargetCache(),this.Ti=t.getBundleCache(),this.Ns(n)}Ns(t){this.documentOverlayCache=this.persistence.getDocumentOverlayCache(t),this.indexManager=this.persistence.getIndexManager(t),this.mutationQueue=this.persistence.getMutationQueue(t,this.indexManager),this.localDocuments=new kC(this.Os,this.mutationQueue,this.documentOverlayCache,this.indexManager),this.Os.setIndexManager(this.indexManager),this.Cs.initialize(this.localDocuments,this.indexManager)}collectGarbage(t){return this.persistence.runTransaction("Collect garbage","readwrite-primary",e=>t.collect(e,this.Fs))}}function QC(i,t,e,n){return new ZC(i,t,e,n)}async function vv(i,t){const e=jt(i);return await e.persistence.runTransaction("Handle user change","readonly",n=>{let s;return e.mutationQueue.getAllMutationBatches(n).next(r=>(s=r,e.Ns(t),e.mutationQueue.getAllMutationBatches(n))).next(r=>{const o=[],a=[];let c=se();for(const l of s){o.push(l.batchId);for(const h of l.mutations)c=c.add(h.key)}for(const l of r){a.push(l.batchId);for(const h of l.mutations)c=c.add(h.key)}return e.localDocuments.getDocuments(n,c).next(l=>({Bs:l,removedBatchIds:o,addedBatchIds:a}))})})}function tP(i,t){const e=jt(i);return e.persistence.runTransaction("Acknowledge batch","readwrite-primary",n=>{const s=t.batch.keys(),r=e.Os.newChangeBuffer({trackRemovals:!0});return function(a,c,l,h){const d=l.batch,f=d.keys();let p=tt.resolve();return f.forEach(v=>{p=p.next(()=>h.getEntry(c,v)).next(x=>{const m=l.docVersions.get(v);ye(m!==null,48541),x.version.compareTo(m)<0&&(d.applyToRemoteDocument(x,l),x.isValidDocument()&&(x.setReadTime(l.commitVersion),h.addEntry(x)))})}),p.next(()=>a.mutationQueue.removeMutationBatch(c,d))}(e,n,t,r).next(()=>r.apply(n)).next(()=>e.mutationQueue.performConsistencyCheck(n)).next(()=>e.documentOverlayCache.removeOverlaysForBatchId(n,s,t.batch.batchId)).next(()=>e.localDocuments.recalculateAndSaveOverlaysForDocumentKeys(n,function(a){let c=se();for(let l=0;l<a.mutationResults.length;++l)a.mutationResults[l].transformResults.length>0&&(c=c.add(a.batch.mutations[l].key));return c}(t))).next(()=>e.localDocuments.getDocuments(n,s))})}function yv(i){const t=jt(i);return t.persistence.runTransaction("Get last remote snapshot version","readonly",e=>t.hi.getLastRemoteSnapshotVersion(e))}function eP(i,t){const e=jt(i),n=t.snapshotVersion;let s=e.Fs;return e.persistence.runTransaction("Apply remote event","readwrite-primary",r=>{const o=e.Os.newChangeBuffer({trackRemovals:!0});s=e.Fs;const a=[];t.targetChanges.forEach((h,d)=>{const f=s.get(d);if(!f)return;a.push(e.hi.removeMatchingKeys(r,h.removedDocuments,d).next(()=>e.hi.addMatchingKeys(r,h.addedDocuments,d)));let p=f.withSequenceNumber(r.currentSequenceNumber);t.targetMismatches.get(d)!==null?p=p.withResumeToken(pn.EMPTY_BYTE_STRING,Wt.min()).withLastLimboFreeSnapshotVersion(Wt.min()):h.resumeToken.approximateByteSize()>0&&(p=p.withResumeToken(h.resumeToken,n)),s=s.insert(d,p),function(x,m,_){return x.resumeToken.approximateByteSize()===0||m.snapshotVersion.toMicroseconds()-x.snapshotVersion.toMicroseconds()>=JC?!0:_.addedDocuments.size+_.modifiedDocuments.size+_.removedDocuments.size>0}(f,p,h)&&a.push(e.hi.updateTargetData(r,p))});let c=Gi(),l=se();if(t.documentUpdates.forEach(h=>{t.resolvedLimboDocuments.has(h)&&a.push(e.persistence.referenceDelegate.updateLimboDocument(r,h))}),a.push(nP(r,o,t.documentUpdates).next(h=>{c=h.Ls,l=h.ks})),!n.isEqual(Wt.min())){const h=e.hi.getLastRemoteSnapshotVersion(r).next(d=>e.hi.setTargetsMetadata(r,r.currentSequenceNumber,n));a.push(h)}return tt.waitFor(a).next(()=>o.apply(r)).next(()=>e.localDocuments.getLocalViewOfDocuments(r,c,l)).next(()=>c)}).then(r=>(e.Fs=s,r))}function nP(i,t,e){let n=se(),s=se();return e.forEach(r=>n=n.add(r)),t.getEntries(i,n).next(r=>{let o=Gi();return e.forEach((a,c)=>{const l=r.get(a);c.isFoundDocument()!==l.isFoundDocument()&&(s=s.add(a)),c.isNoDocument()&&c.version.isEqual(Wt.min())?(t.removeEntry(a,c.readTime),o=o.insert(a,c)):!l.isValidDocument()||c.version.compareTo(l.version)>0||c.version.compareTo(l.version)===0&&l.hasPendingWrites?(t.addEntry(c),o=o.insert(a,c)):xt(df,"Ignoring outdated watch update for ",a,". Current version:",l.version," Watch version:",c.version)}),{Ls:o,ks:s}})}function iP(i,t){const e=jt(i);return e.persistence.runTransaction("Get next mutation batch","readonly",n=>(t===void 0&&(t=Jd),e.mutationQueue.getNextMutationBatchAfterBatchId(n,t)))}function sP(i,t){const e=jt(i);return e.persistence.runTransaction("Allocate target","readwrite",n=>{let s;return e.hi.getTargetData(n,t).next(r=>r?(s=r,tt.resolve(s)):e.hi.allocateTargetId(n).next(o=>(s=new as(t,o,"TargetPurposeListen",n.currentSequenceNumber),e.hi.addTargetData(n,s).next(()=>s))))}).then(n=>{const s=e.Fs.get(n.targetId);return(s===null||n.snapshotVersion.compareTo(s.snapshotVersion)>0)&&(e.Fs=e.Fs.insert(n.targetId,n),e.Ms.set(t,n.targetId)),n})}async function ld(i,t,e){const n=jt(i),s=n.Fs.get(t),r=e?"readwrite":"readwrite-primary";try{e||await n.persistence.runTransaction("Release target",r,o=>n.persistence.referenceDelegate.removeTarget(o,s))}catch(o){if(!_o(o))throw o;xt(df,`Failed to update sequence numbers for target ${t}: ${o}`)}n.Fs=n.Fs.remove(t),n.Ms.delete(s.target)}function Ig(i,t,e){const n=jt(i);let s=Wt.min(),r=se();return n.persistence.runTransaction("Execute query","readwrite",o=>function(c,l,h){const d=jt(c),f=d.Ms.get(h);return f!==void 0?tt.resolve(d.Fs.get(f)):d.hi.getTargetData(l,h)}(n,o,pi(t)).next(a=>{if(a)return s=a.lastLimboFreeSnapshotVersion,n.hi.getMatchingKeysForTargetId(o,a.targetId).next(c=>{r=c})}).next(()=>n.Cs.getDocumentsMatchingQuery(o,t,e?s:Wt.min(),e?r:se())).next(a=>(rP(n,XI(t),a),{documents:a,qs:r})))}function rP(i,t,e){let n=i.xs.get(t)||Wt.min();e.forEach((s,r)=>{r.readTime.compareTo(n)>0&&(n=r.readTime)}),i.xs.set(t,n)}class Cg{constructor(){this.activeTargetIds=JI()}Gs(t){this.activeTargetIds=this.activeTargetIds.add(t)}zs(t){this.activeTargetIds=this.activeTargetIds.delete(t)}Ws(){const t={activeTargetIds:this.activeTargetIds.toArray(),updateTimeMs:Date.now()};return JSON.stringify(t)}}class oP{constructor(){this.Fo=new Cg,this.Mo={},this.onlineStateHandler=null,this.sequenceNumberHandler=null}addPendingMutation(t){}updateMutationState(t,e,n){}addLocalQueryTarget(t,e=!0){return e&&this.Fo.Gs(t),this.Mo[t]||"not-current"}updateQueryState(t,e,n){this.Mo[t]=e}removeLocalQueryTarget(t){this.Fo.zs(t)}isLocalQueryTarget(t){return this.Fo.activeTargetIds.has(t)}clearQueryState(t){delete this.Mo[t]}getAllActiveQueryTargets(){return this.Fo.activeTargetIds}isActiveQueryTarget(t){return this.Fo.activeTargetIds.has(t)}start(){return this.Fo=new Cg,Promise.resolve()}handleUserChange(t,e,n){}setOnlineState(t){}shutdown(){}writeSequenceNumber(t){}notifyBundleLoaded(t){}}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class aP{xo(t){}shutdown(){}}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Pg="ConnectivityMonitor";class Dg{constructor(){this.Oo=()=>this.No(),this.Bo=()=>this.Lo(),this.ko=[],this.qo()}xo(t){this.ko.push(t)}shutdown(){window.removeEventListener("online",this.Oo),window.removeEventListener("offline",this.Bo)}qo(){window.addEventListener("online",this.Oo),window.addEventListener("offline",this.Bo)}No(){xt(Pg,"Network connectivity changed: AVAILABLE");for(const t of this.ko)t(0)}Lo(){xt(Pg,"Network connectivity changed: UNAVAILABLE");for(const t of this.ko)t(1)}static C(){return typeof window<"u"&&window.addEventListener!==void 0&&window.removeEventListener!==void 0}}/**
 * @license
 * Copyright 2023 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */let Lc=null;function ud(){return Lc===null?Lc=function(){return 268435456+Math.round(2147483648*Math.random())}():Lc++,"0x"+Lc.toString(16)}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const qu="RestConnection",cP={BatchGetDocuments:"batchGet",Commit:"commit",RunQuery:"runQuery",RunAggregationQuery:"runAggregationQuery"};class lP{get Qo(){return!1}constructor(t){this.databaseInfo=t,this.databaseId=t.databaseId;const e=t.ssl?"https":"http",n=encodeURIComponent(this.databaseId.projectId),s=encodeURIComponent(this.databaseId.database);this.$o=e+"://"+t.host,this.Uo=`projects/${n}/databases/${s}`,this.Ko=this.databaseId.database===pl?`project_id=${n}`:`project_id=${n}&database_id=${s}`}Wo(t,e,n,s,r){const o=ud(),a=this.Go(t,e.toUriEncodedString());xt(qu,`Sending RPC '${t}' ${o}:`,a,n);const c={"google-cloud-resource-prefix":this.Uo,"x-goog-request-params":this.Ko};this.zo(c,s,r);const{host:l}=new URL(a),h=qd(l);return this.jo(t,a,c,n,h).then(d=>(xt(qu,`Received RPC '${t}' ${o}: `,d),d),d=>{throw vs(qu,`RPC '${t}' ${o} failed with error: `,d,"url: ",a,"request:",n),d})}Jo(t,e,n,s,r,o){return this.Wo(t,e,n,s,r)}zo(t,e,n){t["X-Goog-Api-Client"]=function(){return"gl-js/ fire/"+mo}(),t["Content-Type"]="text/plain",this.databaseInfo.appId&&(t["X-Firebase-GMPID"]=this.databaseInfo.appId),e&&e.headers.forEach((s,r)=>t[r]=s),n&&n.headers.forEach((s,r)=>t[r]=s)}Go(t,e){const n=cP[t];return`${this.$o}/v1/${e}:${n}`}terminate(){}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class uP{constructor(t){this.Ho=t.Ho,this.Yo=t.Yo}Zo(t){this.Xo=t}e_(t){this.t_=t}n_(t){this.r_=t}onMessage(t){this.i_=t}close(){this.Yo()}send(t){this.Ho(t)}s_(){this.Xo()}o_(){this.t_()}__(t){this.r_(t)}a_(t){this.i_(t)}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const En="WebChannelConnection";class hP extends lP{constructor(t){super(t),this.u_=[],this.forceLongPolling=t.forceLongPolling,this.autoDetectLongPolling=t.autoDetectLongPolling,this.useFetchStreams=t.useFetchStreams,this.longPollingOptions=t.longPollingOptions}jo(t,e,n,s,r){const o=ud();return new Promise((a,c)=>{const l=new E0;l.setWithCredentials(!0),l.listenOnce(T0.COMPLETE,()=>{try{switch(l.getLastErrorCode()){case Wc.NO_ERROR:const d=l.getResponseJson();xt(En,`XHR for RPC '${t}' ${o} received:`,JSON.stringify(d)),a(d);break;case Wc.TIMEOUT:xt(En,`RPC '${t}' ${o} timed out`),c(new Dt(it.DEADLINE_EXCEEDED,"Request time out"));break;case Wc.HTTP_ERROR:const f=l.getStatus();if(xt(En,`RPC '${t}' ${o} failed with status:`,f,"response text:",l.getResponseText()),f>0){let p=l.getResponseJson();Array.isArray(p)&&(p=p[0]);const v=p?.error;if(v&&v.status&&v.message){const x=function(_){const A=_.toLowerCase().replace(/_/g,"-");return Object.values(it).indexOf(A)>=0?A:it.UNKNOWN}(v.status);c(new Dt(x,v.message))}else c(new Dt(it.UNKNOWN,"Server responded with status "+l.getStatus()))}else c(new Dt(it.UNAVAILABLE,"Connection failed."));break;default:Ft(9055,{c_:t,streamId:o,l_:l.getLastErrorCode(),h_:l.getLastError()})}}finally{xt(En,`RPC '${t}' ${o} completed.`)}});const h=JSON.stringify(s);xt(En,`RPC '${t}' ${o} sending request:`,s),l.send(e,"POST",h,n,15)})}P_(t,e,n){const s=ud(),r=[this.$o,"/","google.firestore.v1.Firestore","/",t,"/channel"],o=M0(),a=A0(),c={httpSessionIdParam:"gsessionid",initMessageHeaders:{},messageUrlParams:{database:`projects/${this.databaseId.projectId}/databases/${this.databaseId.database}`},sendRawJson:!0,supportsCrossDomainXhr:!0,internalChannelParams:{forwardChannelRequestTimeoutMs:6e5},forceLongPolling:this.forceLongPolling,detectBufferingProxy:this.autoDetectLongPolling},l=this.longPollingOptions.timeoutSeconds;l!==void 0&&(c.longPollingTimeout=Math.round(1e3*l)),this.useFetchStreams&&(c.useFetchStreams=!0),this.zo(c.initMessageHeaders,e,n),c.encodeInitMessageHeaders=!0;const h=r.join("");xt(En,`Creating RPC '${t}' stream ${s}: ${h}`,c);const d=o.createWebChannel(h,c);this.T_(d);let f=!1,p=!1;const v=new uP({Ho:m=>{p?xt(En,`Not sending because RPC '${t}' stream ${s} is closed:`,m):(f||(xt(En,`Opening RPC '${t}' stream ${s} transport.`),d.open(),f=!0),xt(En,`RPC '${t}' stream ${s} sending:`,m),d.send(m))},Yo:()=>d.close()}),x=(m,_,A)=>{m.listen(_,S=>{try{A(S)}catch(b){setTimeout(()=>{throw b},0)}})};return x(d,jo.EventType.OPEN,()=>{p||(xt(En,`RPC '${t}' stream ${s} transport opened.`),v.s_())}),x(d,jo.EventType.CLOSE,()=>{p||(p=!0,xt(En,`RPC '${t}' stream ${s} transport closed`),v.__(),this.I_(d))}),x(d,jo.EventType.ERROR,m=>{p||(p=!0,vs(En,`RPC '${t}' stream ${s} transport errored. Name:`,m.name,"Message:",m.message),v.__(new Dt(it.UNAVAILABLE,"The operation could not be completed")))}),x(d,jo.EventType.MESSAGE,m=>{var _;if(!p){const A=m.data[0];ye(!!A,16349);const S=A,b=S?.error||((_=S[0])===null||_===void 0?void 0:_.error);if(b){xt(En,`RPC '${t}' stream ${s} received error:`,b);const F=b.status;let N=function(C){const y=Ge[C];if(y!==void 0)return ov(y)}(F),M=b.message;N===void 0&&(N=it.INTERNAL,M="Unknown error status: "+F+" with message "+b.message),p=!0,v.__(new Dt(N,M)),d.close()}else xt(En,`RPC '${t}' stream ${s} received:`,A),v.a_(A)}}),x(a,S0.STAT_EVENT,m=>{m.stat===Zh.PROXY?xt(En,`RPC '${t}' stream ${s} detected buffering proxy`):m.stat===Zh.NOPROXY&&xt(En,`RPC '${t}' stream ${s} detected no buffering proxy`)}),setTimeout(()=>{v.o_()},0),v}terminate(){this.u_.forEach(t=>t.close()),this.u_=[]}T_(t){this.u_.push(t)}I_(t){this.u_=this.u_.filter(e=>e===t)}}function ju(){return typeof document<"u"?document:null}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function kl(i){return new mC(i,!0)}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class xv{constructor(t,e,n=1e3,s=1.5,r=6e4){this.Fi=t,this.timerId=e,this.d_=n,this.E_=s,this.A_=r,this.R_=0,this.V_=null,this.m_=Date.now(),this.reset()}reset(){this.R_=0}f_(){this.R_=this.A_}g_(t){this.cancel();const e=Math.floor(this.R_+this.p_()),n=Math.max(0,Date.now()-this.m_),s=Math.max(0,e-n);s>0&&xt("ExponentialBackoff",`Backing off for ${s} ms (base delay: ${this.R_} ms, delay with jitter: ${e} ms, last attempt: ${n} ms ago)`),this.V_=this.Fi.enqueueAfterDelay(this.timerId,s,()=>(this.m_=Date.now(),t())),this.R_*=this.E_,this.R_<this.d_&&(this.R_=this.d_),this.R_>this.A_&&(this.R_=this.A_)}y_(){this.V_!==null&&(this.V_.skipDelay(),this.V_=null)}cancel(){this.V_!==null&&(this.V_.cancel(),this.V_=null)}p_(){return(Math.random()-.5)*this.R_}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Lg="PersistentStream";class Ev{constructor(t,e,n,s,r,o,a,c){this.Fi=t,this.w_=n,this.S_=s,this.connection=r,this.authCredentialsProvider=o,this.appCheckCredentialsProvider=a,this.listener=c,this.state=0,this.b_=0,this.D_=null,this.v_=null,this.stream=null,this.C_=0,this.F_=new xv(t,e)}M_(){return this.state===1||this.state===5||this.x_()}x_(){return this.state===2||this.state===3}start(){this.C_=0,this.state!==4?this.auth():this.O_()}async stop(){this.M_()&&await this.close(0)}N_(){this.state=0,this.F_.reset()}B_(){this.x_()&&this.D_===null&&(this.D_=this.Fi.enqueueAfterDelay(this.w_,6e4,()=>this.L_()))}k_(t){this.q_(),this.stream.send(t)}async L_(){if(this.x_())return this.close(0)}q_(){this.D_&&(this.D_.cancel(),this.D_=null)}Q_(){this.v_&&(this.v_.cancel(),this.v_=null)}async close(t,e){this.q_(),this.Q_(),this.F_.cancel(),this.b_++,t!==4?this.F_.reset():e&&e.code===it.RESOURCE_EXHAUSTED?(Hi(e.toString()),Hi("Using maximum backoff delay to prevent overloading the backend."),this.F_.f_()):e&&e.code===it.UNAUTHENTICATED&&this.state!==3&&(this.authCredentialsProvider.invalidateToken(),this.appCheckCredentialsProvider.invalidateToken()),this.stream!==null&&(this.U_(),this.stream.close(),this.stream=null),this.state=t,await this.listener.n_(e)}U_(){}auth(){this.state=1;const t=this.K_(this.b_),e=this.b_;Promise.all([this.authCredentialsProvider.getToken(),this.appCheckCredentialsProvider.getToken()]).then(([n,s])=>{this.b_===e&&this.W_(n,s)},n=>{t(()=>{const s=new Dt(it.UNKNOWN,"Fetching auth token failed: "+n.message);return this.G_(s)})})}W_(t,e){const n=this.K_(this.b_);this.stream=this.z_(t,e),this.stream.Zo(()=>{n(()=>this.listener.Zo())}),this.stream.e_(()=>{n(()=>(this.state=2,this.v_=this.Fi.enqueueAfterDelay(this.S_,1e4,()=>(this.x_()&&(this.state=3),Promise.resolve())),this.listener.e_()))}),this.stream.n_(s=>{n(()=>this.G_(s))}),this.stream.onMessage(s=>{n(()=>++this.C_==1?this.j_(s):this.onNext(s))})}O_(){this.state=5,this.F_.g_(async()=>{this.state=0,this.start()})}G_(t){return xt(Lg,`close with error: ${t}`),this.stream=null,this.close(4,t)}K_(t){return e=>{this.Fi.enqueueAndForget(()=>this.b_===t?e():(xt(Lg,"stream callback skipped by getCloseGuardedDispatcher."),Promise.resolve()))}}}class dP extends Ev{constructor(t,e,n,s,r,o){super(t,"listen_stream_connection_backoff","listen_stream_idle","health_check_timeout",e,n,s,o),this.serializer=r}z_(t,e){return this.connection.P_("Listen",t,e)}j_(t){return this.onNext(t)}onNext(t){this.F_.reset();const e=vC(this.serializer,t),n=function(r){if(!("targetChange"in r))return Wt.min();const o=r.targetChange;return o.targetIds&&o.targetIds.length?Wt.min():o.readTime?gi(o.readTime):Wt.min()}(t);return this.listener.J_(e,n)}H_(t){const e={};e.database=cd(this.serializer),e.addTarget=function(r,o){let a;const c=o.target;if(a=id(c)?{documents:EC(r,c)}:{query:TC(r,c).Vt},a.targetId=o.targetId,o.resumeToken.approximateByteSize()>0){a.resumeToken=lv(r,o.resumeToken);const l=rd(r,o.expectedCount);l!==null&&(a.expectedCount=l)}else if(o.snapshotVersion.compareTo(Wt.min())>0){a.readTime=yl(r,o.snapshotVersion.toTimestamp());const l=rd(r,o.expectedCount);l!==null&&(a.expectedCount=l)}return a}(this.serializer,t);const n=AC(this.serializer,t);n&&(e.labels=n),this.k_(e)}Y_(t){const e={};e.database=cd(this.serializer),e.removeTarget=t,this.k_(e)}}class fP extends Ev{constructor(t,e,n,s,r,o){super(t,"write_stream_connection_backoff","write_stream_idle","health_check_timeout",e,n,s,o),this.serializer=r}get Z_(){return this.C_>0}start(){this.lastStreamToken=void 0,super.start()}U_(){this.Z_&&this.X_([])}z_(t,e){return this.connection.P_("Write",t,e)}j_(t){return ye(!!t.streamToken,31322),this.lastStreamToken=t.streamToken,ye(!t.writeResults||t.writeResults.length===0,55816),this.listener.ea()}onNext(t){ye(!!t.streamToken,12678),this.lastStreamToken=t.streamToken,this.F_.reset();const e=xC(t.writeResults,t.commitTime),n=gi(t.commitTime);return this.listener.ta(n,e)}na(){const t={};t.database=cd(this.serializer),this.k_(t)}X_(t){const e={streamToken:this.lastStreamToken,writes:t.map(n=>yC(this.serializer,n))};this.k_(e)}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class pP{}class mP extends pP{constructor(t,e,n,s){super(),this.authCredentials=t,this.appCheckCredentials=e,this.connection=n,this.serializer=s,this.ra=!1}ia(){if(this.ra)throw new Dt(it.FAILED_PRECONDITION,"The client has already been terminated.")}Wo(t,e,n,s){return this.ia(),Promise.all([this.authCredentials.getToken(),this.appCheckCredentials.getToken()]).then(([r,o])=>this.connection.Wo(t,od(e,n),s,r,o)).catch(r=>{throw r.name==="FirebaseError"?(r.code===it.UNAUTHENTICATED&&(this.authCredentials.invalidateToken(),this.appCheckCredentials.invalidateToken()),r):new Dt(it.UNKNOWN,r.toString())})}Jo(t,e,n,s,r){return this.ia(),Promise.all([this.authCredentials.getToken(),this.appCheckCredentials.getToken()]).then(([o,a])=>this.connection.Jo(t,od(e,n),s,o,a,r)).catch(o=>{throw o.name==="FirebaseError"?(o.code===it.UNAUTHENTICATED&&(this.authCredentials.invalidateToken(),this.appCheckCredentials.invalidateToken()),o):new Dt(it.UNKNOWN,o.toString())})}terminate(){this.ra=!0,this.connection.terminate()}}class gP{constructor(t,e){this.asyncQueue=t,this.onlineStateHandler=e,this.state="Unknown",this.sa=0,this.oa=null,this._a=!0}aa(){this.sa===0&&(this.ua("Unknown"),this.oa=this.asyncQueue.enqueueAfterDelay("online_state_timeout",1e4,()=>(this.oa=null,this.ca("Backend didn't respond within 10 seconds."),this.ua("Offline"),Promise.resolve())))}la(t){this.state==="Online"?this.ua("Unknown"):(this.sa++,this.sa>=1&&(this.ha(),this.ca(`Connection failed 1 times. Most recent error: ${t.toString()}`),this.ua("Offline")))}set(t){this.ha(),this.sa=0,t==="Online"&&(this._a=!1),this.ua(t)}ua(t){t!==this.state&&(this.state=t,this.onlineStateHandler(t))}ca(t){const e=`Could not reach Cloud Firestore backend. ${t}
This typically indicates that your device does not have a healthy Internet connection at the moment. The client will operate in offline mode until it is able to successfully connect to the backend.`;this._a?(Hi(e),this._a=!1):xt("OnlineStateTracker",e)}ha(){this.oa!==null&&(this.oa.cancel(),this.oa=null)}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Qs="RemoteStore";class _P{constructor(t,e,n,s,r){this.localStore=t,this.datastore=e,this.asyncQueue=n,this.remoteSyncer={},this.Pa=[],this.Ta=new Map,this.Ia=new Set,this.da=[],this.Ea=r,this.Ea.xo(o=>{n.enqueueAndForget(async()=>{ir(this)&&(xt(Qs,"Restarting streams for network reachability change."),await async function(c){const l=jt(c);l.Ia.add(4),await Oa(l),l.Aa.set("Unknown"),l.Ia.delete(4),await zl(l)}(this))})}),this.Aa=new gP(n,s)}}async function zl(i){if(ir(i))for(const t of i.da)await t(!0)}async function Oa(i){for(const t of i.da)await t(!1)}function Tv(i,t){const e=jt(i);e.Ta.has(t.targetId)||(e.Ta.set(t.targetId,t),gf(e)?mf(e):vo(e).x_()&&pf(e,t))}function ff(i,t){const e=jt(i),n=vo(e);e.Ta.delete(t),n.x_()&&Sv(e,t),e.Ta.size===0&&(n.x_()?n.B_():ir(e)&&e.Aa.set("Unknown"))}function pf(i,t){if(i.Ra.$e(t.targetId),t.resumeToken.approximateByteSize()>0||t.snapshotVersion.compareTo(Wt.min())>0){const e=i.remoteSyncer.getRemoteKeysForTarget(t.targetId).size;t=t.withExpectedCount(e)}vo(i).H_(t)}function Sv(i,t){i.Ra.$e(t),vo(i).Y_(t)}function mf(i){i.Ra=new hC({getRemoteKeysForTarget:t=>i.remoteSyncer.getRemoteKeysForTarget(t),Et:t=>i.Ta.get(t)||null,lt:()=>i.datastore.serializer.databaseId}),vo(i).start(),i.Aa.aa()}function gf(i){return ir(i)&&!vo(i).M_()&&i.Ta.size>0}function ir(i){return jt(i).Ia.size===0}function Av(i){i.Ra=void 0}async function vP(i){i.Aa.set("Online")}async function yP(i){i.Ta.forEach((t,e)=>{pf(i,t)})}async function xP(i,t){Av(i),gf(i)?(i.Aa.la(t),mf(i)):i.Aa.set("Unknown")}async function EP(i,t,e){if(i.Aa.set("Online"),t instanceof cv&&t.state===2&&t.cause)try{await async function(s,r){const o=r.cause;for(const a of r.targetIds)s.Ta.has(a)&&(await s.remoteSyncer.rejectListen(a,o),s.Ta.delete(a),s.Ra.removeTarget(a))}(i,t)}catch(n){xt(Qs,"Failed to remove targets %s: %s ",t.targetIds.join(","),n),await El(i,n)}else if(t instanceof Kc?i.Ra.Ye(t):t instanceof av?i.Ra.it(t):i.Ra.et(t),!e.isEqual(Wt.min()))try{const n=await yv(i.localStore);e.compareTo(n)>=0&&await function(r,o){const a=r.Ra.Pt(o);return a.targetChanges.forEach((c,l)=>{if(c.resumeToken.approximateByteSize()>0){const h=r.Ta.get(l);h&&r.Ta.set(l,h.withResumeToken(c.resumeToken,o))}}),a.targetMismatches.forEach((c,l)=>{const h=r.Ta.get(c);if(!h)return;r.Ta.set(c,h.withResumeToken(pn.EMPTY_BYTE_STRING,h.snapshotVersion)),Sv(r,c);const d=new as(h.target,c,l,h.sequenceNumber);pf(r,d)}),r.remoteSyncer.applyRemoteEvent(a)}(i,e)}catch(n){xt(Qs,"Failed to raise snapshot:",n),await El(i,n)}}async function El(i,t,e){if(!_o(t))throw t;i.Ia.add(1),await Oa(i),i.Aa.set("Offline"),e||(e=()=>yv(i.localStore)),i.asyncQueue.enqueueRetryable(async()=>{xt(Qs,"Retrying IndexedDB access"),await e(),i.Ia.delete(1),await zl(i)})}function Mv(i,t){return t().catch(e=>El(i,e,t))}async function Hl(i){const t=jt(i),e=Ss(t);let n=t.Pa.length>0?t.Pa[t.Pa.length-1].batchId:Jd;for(;TP(t);)try{const s=await iP(t.localStore,n);if(s===null){t.Pa.length===0&&e.B_();break}n=s.batchId,SP(t,s)}catch(s){await El(t,s)}wv(t)&&bv(t)}function TP(i){return ir(i)&&i.Pa.length<10}function SP(i,t){i.Pa.push(t);const e=Ss(i);e.x_()&&e.Z_&&e.X_(t.mutations)}function wv(i){return ir(i)&&!Ss(i).M_()&&i.Pa.length>0}function bv(i){Ss(i).start()}async function AP(i){Ss(i).na()}async function MP(i){const t=Ss(i);for(const e of i.Pa)t.X_(e.mutations)}async function wP(i,t,e){const n=i.Pa.shift(),s=of.from(n,t,e);await Mv(i,()=>i.remoteSyncer.applySuccessfulWrite(s)),await Hl(i)}async function bP(i,t){t&&Ss(i).Z_&&await async function(n,s){if(function(o){return lC(o)&&o!==it.ABORTED}(s.code)){const r=n.Pa.shift();Ss(n).N_(),await Mv(n,()=>n.remoteSyncer.rejectFailedWrite(r.batchId,s)),await Hl(n)}}(i,t),wv(i)&&bv(i)}async function Ng(i,t){const e=jt(i);e.asyncQueue.verifyOperationInProgress(),xt(Qs,"RemoteStore received new credentials");const n=ir(e);e.Ia.add(3),await Oa(e),n&&e.Aa.set("Unknown"),await e.remoteSyncer.handleCredentialChange(t),e.Ia.delete(3),await zl(e)}async function RP(i,t){const e=jt(i);t?(e.Ia.delete(2),await zl(e)):t||(e.Ia.add(2),await Oa(e),e.Aa.set("Unknown"))}function vo(i){return i.Va||(i.Va=function(e,n,s){const r=jt(e);return r.ia(),new dP(n,r.connection,r.authCredentials,r.appCheckCredentials,r.serializer,s)}(i.datastore,i.asyncQueue,{Zo:vP.bind(null,i),e_:yP.bind(null,i),n_:xP.bind(null,i),J_:EP.bind(null,i)}),i.da.push(async t=>{t?(i.Va.N_(),gf(i)?mf(i):i.Aa.set("Unknown")):(await i.Va.stop(),Av(i))})),i.Va}function Ss(i){return i.ma||(i.ma=function(e,n,s){const r=jt(e);return r.ia(),new fP(n,r.connection,r.authCredentials,r.appCheckCredentials,r.serializer,s)}(i.datastore,i.asyncQueue,{Zo:()=>Promise.resolve(),e_:AP.bind(null,i),n_:bP.bind(null,i),ea:MP.bind(null,i),ta:wP.bind(null,i)}),i.da.push(async t=>{t?(i.ma.N_(),await Hl(i)):(await i.ma.stop(),i.Pa.length>0&&(xt(Qs,`Stopping write stream with ${i.Pa.length} pending writes`),i.Pa=[]))})),i.ma}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class _f{constructor(t,e,n,s,r){this.asyncQueue=t,this.timerId=e,this.targetTimeMs=n,this.op=s,this.removalCallback=r,this.deferred=new Xs,this.then=this.deferred.promise.then.bind(this.deferred.promise),this.deferred.promise.catch(o=>{})}get promise(){return this.deferred.promise}static createAndSchedule(t,e,n,s,r){const o=Date.now()+n,a=new _f(t,e,o,s,r);return a.start(n),a}start(t){this.timerHandle=setTimeout(()=>this.handleDelayElapsed(),t)}skipDelay(){return this.handleDelayElapsed()}cancel(t){this.timerHandle!==null&&(this.clearTimeout(),this.deferred.reject(new Dt(it.CANCELLED,"Operation cancelled"+(t?": "+t:""))))}handleDelayElapsed(){this.asyncQueue.enqueueAndForget(()=>this.timerHandle!==null?(this.clearTimeout(),this.op().then(t=>this.deferred.resolve(t))):Promise.resolve())}clearTimeout(){this.timerHandle!==null&&(this.removalCallback(this),clearTimeout(this.timerHandle),this.timerHandle=null)}}function vf(i,t){if(Hi("AsyncQueue",`${t}: ${i}`),_o(i))return new Dt(it.UNAVAILABLE,`${t}: ${i}`);throw i}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Wr{static emptySet(t){return new Wr(t.comparator)}constructor(t){this.comparator=t?(e,n)=>t(e,n)||Lt.comparator(e.key,n.key):(e,n)=>Lt.comparator(e.key,n.key),this.keyedMap=Ko(),this.sortedSet=new Oe(this.comparator)}has(t){return this.keyedMap.get(t)!=null}get(t){return this.keyedMap.get(t)}first(){return this.sortedSet.minKey()}last(){return this.sortedSet.maxKey()}isEmpty(){return this.sortedSet.isEmpty()}indexOf(t){const e=this.keyedMap.get(t);return e?this.sortedSet.indexOf(e):-1}get size(){return this.sortedSet.size}forEach(t){this.sortedSet.inorderTraversal((e,n)=>(t(e),!1))}add(t){const e=this.delete(t.key);return e.copy(e.keyedMap.insert(t.key,t),e.sortedSet.insert(t,null))}delete(t){const e=this.get(t);return e?this.copy(this.keyedMap.remove(t),this.sortedSet.remove(e)):this}isEqual(t){if(!(t instanceof Wr)||this.size!==t.size)return!1;const e=this.sortedSet.getIterator(),n=t.sortedSet.getIterator();for(;e.hasNext();){const s=e.getNext().key,r=n.getNext().key;if(!s.isEqual(r))return!1}return!0}toString(){const t=[];return this.forEach(e=>{t.push(e.toString())}),t.length===0?"DocumentSet ()":`DocumentSet (
  `+t.join(`  
`)+`
)`}copy(t,e){const n=new Wr;return n.comparator=this.comparator,n.keyedMap=t,n.sortedSet=e,n}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Ug{constructor(){this.fa=new Oe(Lt.comparator)}track(t){const e=t.doc.key,n=this.fa.get(e);n?t.type!==0&&n.type===3?this.fa=this.fa.insert(e,t):t.type===3&&n.type!==1?this.fa=this.fa.insert(e,{type:n.type,doc:t.doc}):t.type===2&&n.type===2?this.fa=this.fa.insert(e,{type:2,doc:t.doc}):t.type===2&&n.type===0?this.fa=this.fa.insert(e,{type:0,doc:t.doc}):t.type===1&&n.type===0?this.fa=this.fa.remove(e):t.type===1&&n.type===2?this.fa=this.fa.insert(e,{type:1,doc:n.doc}):t.type===0&&n.type===1?this.fa=this.fa.insert(e,{type:2,doc:t.doc}):Ft(63341,{At:t,ga:n}):this.fa=this.fa.insert(e,t)}pa(){const t=[];return this.fa.inorderTraversal((e,n)=>{t.push(n)}),t}}class co{constructor(t,e,n,s,r,o,a,c,l){this.query=t,this.docs=e,this.oldDocs=n,this.docChanges=s,this.mutatedKeys=r,this.fromCache=o,this.syncStateChanged=a,this.excludesMetadataChanges=c,this.hasCachedResults=l}static fromInitialDocuments(t,e,n,s,r){const o=[];return e.forEach(a=>{o.push({type:0,doc:a})}),new co(t,e,Wr.emptySet(e),o,n,s,!0,!1,r)}get hasPendingWrites(){return!this.mutatedKeys.isEmpty()}isEqual(t){if(!(this.fromCache===t.fromCache&&this.hasCachedResults===t.hasCachedResults&&this.syncStateChanged===t.syncStateChanged&&this.mutatedKeys.isEqual(t.mutatedKeys)&&Ul(this.query,t.query)&&this.docs.isEqual(t.docs)&&this.oldDocs.isEqual(t.oldDocs)))return!1;const e=this.docChanges,n=t.docChanges;if(e.length!==n.length)return!1;for(let s=0;s<e.length;s++)if(e[s].type!==n[s].type||!e[s].doc.isEqual(n[s].doc))return!1;return!0}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class IP{constructor(){this.ya=void 0,this.wa=[]}Sa(){return this.wa.some(t=>t.ba())}}class CP{constructor(){this.queries=Og(),this.onlineState="Unknown",this.Da=new Set}terminate(){(function(e,n){const s=jt(e),r=s.queries;s.queries=Og(),r.forEach((o,a)=>{for(const c of a.wa)c.onError(n)})})(this,new Dt(it.ABORTED,"Firestore shutting down"))}}function Og(){return new er(i=>j0(i),Ul)}async function PP(i,t){const e=jt(i);let n=3;const s=t.query;let r=e.queries.get(s);r?!r.Sa()&&t.ba()&&(n=2):(r=new IP,n=t.ba()?0:1);try{switch(n){case 0:r.ya=await e.onListen(s,!0);break;case 1:r.ya=await e.onListen(s,!1);break;case 2:await e.onFirstRemoteStoreListen(s)}}catch(o){const a=vf(o,`Initialization of query '${Dr(t.query)}' failed`);return void t.onError(a)}e.queries.set(s,r),r.wa.push(t),t.va(e.onlineState),r.ya&&t.Ca(r.ya)&&yf(e)}async function DP(i,t){const e=jt(i),n=t.query;let s=3;const r=e.queries.get(n);if(r){const o=r.wa.indexOf(t);o>=0&&(r.wa.splice(o,1),r.wa.length===0?s=t.ba()?0:1:!r.Sa()&&t.ba()&&(s=2))}switch(s){case 0:return e.queries.delete(n),e.onUnlisten(n,!0);case 1:return e.queries.delete(n),e.onUnlisten(n,!1);case 2:return e.onLastRemoteStoreUnlisten(n);default:return}}function LP(i,t){const e=jt(i);let n=!1;for(const s of t){const r=s.query,o=e.queries.get(r);if(o){for(const a of o.wa)a.Ca(s)&&(n=!0);o.ya=s}}n&&yf(e)}function NP(i,t,e){const n=jt(i),s=n.queries.get(t);if(s)for(const r of s.wa)r.onError(e);n.queries.delete(t)}function yf(i){i.Da.forEach(t=>{t.next()})}var hd,Fg;(Fg=hd||(hd={})).Fa="default",Fg.Cache="cache";class UP{constructor(t,e,n){this.query=t,this.Ma=e,this.xa=!1,this.Oa=null,this.onlineState="Unknown",this.options=n||{}}Ca(t){if(!this.options.includeMetadataChanges){const n=[];for(const s of t.docChanges)s.type!==3&&n.push(s);t=new co(t.query,t.docs,t.oldDocs,n,t.mutatedKeys,t.fromCache,t.syncStateChanged,!0,t.hasCachedResults)}let e=!1;return this.xa?this.Na(t)&&(this.Ma.next(t),e=!0):this.Ba(t,this.onlineState)&&(this.La(t),e=!0),this.Oa=t,e}onError(t){this.Ma.error(t)}va(t){this.onlineState=t;let e=!1;return this.Oa&&!this.xa&&this.Ba(this.Oa,t)&&(this.La(this.Oa),e=!0),e}Ba(t,e){if(!t.fromCache||!this.ba())return!0;const n=e!=="Offline";return(!this.options.ka||!n)&&(!t.docs.isEmpty()||t.hasCachedResults||e==="Offline")}Na(t){if(t.docChanges.length>0)return!0;const e=this.Oa&&this.Oa.hasPendingWrites!==t.hasPendingWrites;return!(!t.syncStateChanged&&!e)&&this.options.includeMetadataChanges===!0}La(t){t=co.fromInitialDocuments(t.query,t.docs,t.mutatedKeys,t.fromCache,t.hasCachedResults),this.xa=!0,this.Ma.next(t)}ba(){return this.options.source!==hd.Cache}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Rv{constructor(t){this.key=t}}class Iv{constructor(t){this.key=t}}class OP{constructor(t,e){this.query=t,this.Ha=e,this.Ya=null,this.hasCachedResults=!1,this.current=!1,this.Za=se(),this.mutatedKeys=se(),this.Xa=K0(t),this.eu=new Wr(this.Xa)}get tu(){return this.Ha}nu(t,e){const n=e?e.ru:new Ug,s=e?e.eu:this.eu;let r=e?e.mutatedKeys:this.mutatedKeys,o=s,a=!1;const c=this.query.limitType==="F"&&s.size===this.query.limit?s.last():null,l=this.query.limitType==="L"&&s.size===this.query.limit?s.first():null;if(t.inorderTraversal((h,d)=>{const f=s.get(h),p=Ol(this.query,d)?d:null,v=!!f&&this.mutatedKeys.has(f.key),x=!!p&&(p.hasLocalMutations||this.mutatedKeys.has(p.key)&&p.hasCommittedMutations);let m=!1;f&&p?f.data.isEqual(p.data)?v!==x&&(n.track({type:3,doc:p}),m=!0):this.iu(f,p)||(n.track({type:2,doc:p}),m=!0,(c&&this.Xa(p,c)>0||l&&this.Xa(p,l)<0)&&(a=!0)):!f&&p?(n.track({type:0,doc:p}),m=!0):f&&!p&&(n.track({type:1,doc:f}),m=!0,(c||l)&&(a=!0)),m&&(p?(o=o.add(p),r=x?r.add(h):r.delete(h)):(o=o.delete(h),r=r.delete(h)))}),this.query.limit!==null)for(;o.size>this.query.limit;){const h=this.query.limitType==="F"?o.last():o.first();o=o.delete(h.key),r=r.delete(h.key),n.track({type:1,doc:h})}return{eu:o,ru:n,Ds:a,mutatedKeys:r}}iu(t,e){return t.hasLocalMutations&&e.hasCommittedMutations&&!e.hasLocalMutations}applyChanges(t,e,n,s){const r=this.eu;this.eu=t.eu,this.mutatedKeys=t.mutatedKeys;const o=t.ru.pa();o.sort((h,d)=>function(p,v){const x=m=>{switch(m){case 0:return 1;case 2:case 3:return 2;case 1:return 0;default:return Ft(20277,{At:m})}};return x(p)-x(v)}(h.type,d.type)||this.Xa(h.doc,d.doc)),this.su(n),s=s!=null&&s;const a=e&&!s?this.ou():[],c=this.Za.size===0&&this.current&&!s?1:0,l=c!==this.Ya;return this.Ya=c,o.length!==0||l?{snapshot:new co(this.query,t.eu,r,o,t.mutatedKeys,c===0,l,!1,!!n&&n.resumeToken.approximateByteSize()>0),_u:a}:{_u:a}}va(t){return this.current&&t==="Offline"?(this.current=!1,this.applyChanges({eu:this.eu,ru:new Ug,mutatedKeys:this.mutatedKeys,Ds:!1},!1)):{_u:[]}}au(t){return!this.Ha.has(t)&&!!this.eu.has(t)&&!this.eu.get(t).hasLocalMutations}su(t){t&&(t.addedDocuments.forEach(e=>this.Ha=this.Ha.add(e)),t.modifiedDocuments.forEach(e=>{}),t.removedDocuments.forEach(e=>this.Ha=this.Ha.delete(e)),this.current=t.current)}ou(){if(!this.current)return[];const t=this.Za;this.Za=se(),this.eu.forEach(n=>{this.au(n.key)&&(this.Za=this.Za.add(n.key))});const e=[];return t.forEach(n=>{this.Za.has(n)||e.push(new Iv(n))}),this.Za.forEach(n=>{t.has(n)||e.push(new Rv(n))}),e}uu(t){this.Ha=t.qs,this.Za=se();const e=this.nu(t.documents);return this.applyChanges(e,!0)}cu(){return co.fromInitialDocuments(this.query,this.eu,this.mutatedKeys,this.Ya===0,this.hasCachedResults)}}const xf="SyncEngine";class FP{constructor(t,e,n){this.query=t,this.targetId=e,this.view=n}}class VP{constructor(t){this.key=t,this.lu=!1}}class BP{constructor(t,e,n,s,r,o){this.localStore=t,this.remoteStore=e,this.eventManager=n,this.sharedClientState=s,this.currentUser=r,this.maxConcurrentLimboResolutions=o,this.hu={},this.Pu=new er(a=>j0(a),Ul),this.Tu=new Map,this.Iu=new Set,this.du=new Oe(Lt.comparator),this.Eu=new Map,this.Au=new lf,this.Ru={},this.Vu=new Map,this.mu=ao.ur(),this.onlineState="Unknown",this.fu=void 0}get isPrimaryClient(){return this.fu===!0}}async function kP(i,t,e=!0){const n=Uv(i);let s;const r=n.Pu.get(t);return r?(n.sharedClientState.addLocalQueryTarget(r.targetId),s=r.view.cu()):s=await Cv(n,t,e,!0),s}async function zP(i,t){const e=Uv(i);await Cv(e,t,!0,!1)}async function Cv(i,t,e,n){const s=await sP(i.localStore,pi(t)),r=s.targetId,o=i.sharedClientState.addLocalQueryTarget(r,e);let a;return n&&(a=await HP(i,t,r,o==="current",s.resumeToken)),i.isPrimaryClient&&e&&Tv(i.remoteStore,s),a}async function HP(i,t,e,n,s){i.gu=(d,f,p)=>async function(x,m,_,A){let S=m.view.nu(_);S.Ds&&(S=await Ig(x.localStore,m.query,!1).then(({documents:M})=>m.view.nu(M,S)));const b=A&&A.targetChanges.get(m.targetId),F=A&&A.targetMismatches.get(m.targetId)!=null,N=m.view.applyChanges(S,x.isPrimaryClient,b,F);return Bg(x,m.targetId,N._u),N.snapshot}(i,d,f,p);const r=await Ig(i.localStore,t,!0),o=new OP(t,r.qs),a=o.nu(r.documents),c=Ua.createSynthesizedTargetChangeForCurrentChange(e,n&&i.onlineState!=="Offline",s),l=o.applyChanges(a,i.isPrimaryClient,c);Bg(i,e,l._u);const h=new FP(t,e,o);return i.Pu.set(t,h),i.Tu.has(e)?i.Tu.get(e).push(t):i.Tu.set(e,[t]),l.snapshot}async function GP(i,t,e){const n=jt(i),s=n.Pu.get(t),r=n.Tu.get(s.targetId);if(r.length>1)return n.Tu.set(s.targetId,r.filter(o=>!Ul(o,t))),void n.Pu.delete(t);n.isPrimaryClient?(n.sharedClientState.removeLocalQueryTarget(s.targetId),n.sharedClientState.isActiveQueryTarget(s.targetId)||await ld(n.localStore,s.targetId,!1).then(()=>{n.sharedClientState.clearQueryState(s.targetId),e&&ff(n.remoteStore,s.targetId),dd(n,s.targetId)}).catch(go)):(dd(n,s.targetId),await ld(n.localStore,s.targetId,!0))}async function WP(i,t){const e=jt(i),n=e.Pu.get(t),s=e.Tu.get(n.targetId);e.isPrimaryClient&&s.length===1&&(e.sharedClientState.removeLocalQueryTarget(n.targetId),ff(e.remoteStore,n.targetId))}async function XP(i,t,e){const n=ZP(i);try{const s=await function(o,a){const c=jt(o),l=Pe.now(),h=a.reduce((p,v)=>p.add(v.key),se());let d,f;return c.persistence.runTransaction("Locally write mutations","readwrite",p=>{let v=Gi(),x=se();return c.Os.getEntries(p,h).next(m=>{v=m,v.forEach((_,A)=>{A.isValidDocument()||(x=x.add(_))})}).next(()=>c.localDocuments.getOverlayedDocuments(p,v)).next(m=>{d=m;const _=[];for(const A of a){const S=sC(A,d.get(A.key).overlayedDocument);S!=null&&_.push(new nr(A.key,S,k0(S.value.mapValue),mi.exists(!0)))}return c.mutationQueue.addMutationBatch(p,l,_,a)}).next(m=>{f=m;const _=m.applyToLocalDocumentSet(d,x);return c.documentOverlayCache.saveOverlays(p,m.batchId,_)})}).then(()=>({batchId:f.batchId,changes:Y0(d)}))}(n.localStore,t);n.sharedClientState.addPendingMutation(s.batchId),function(o,a,c){let l=o.Ru[o.currentUser.toKey()];l||(l=new Oe(Zt)),l=l.insert(a,c),o.Ru[o.currentUser.toKey()]=l}(n,s.batchId,e),await Fa(n,s.changes),await Hl(n.remoteStore)}catch(s){const r=vf(s,"Failed to persist write");e.reject(r)}}async function Pv(i,t){const e=jt(i);try{const n=await eP(e.localStore,t);t.targetChanges.forEach((s,r)=>{const o=e.Eu.get(r);o&&(ye(s.addedDocuments.size+s.modifiedDocuments.size+s.removedDocuments.size<=1,22616),s.addedDocuments.size>0?o.lu=!0:s.modifiedDocuments.size>0?ye(o.lu,14607):s.removedDocuments.size>0&&(ye(o.lu,42227),o.lu=!1))}),await Fa(e,n,t)}catch(n){await go(n)}}function Vg(i,t,e){const n=jt(i);if(n.isPrimaryClient&&e===0||!n.isPrimaryClient&&e===1){const s=[];n.Pu.forEach((r,o)=>{const a=o.view.va(t);a.snapshot&&s.push(a.snapshot)}),function(o,a){const c=jt(o);c.onlineState=a;let l=!1;c.queries.forEach((h,d)=>{for(const f of d.wa)f.va(a)&&(l=!0)}),l&&yf(c)}(n.eventManager,t),s.length&&n.hu.J_(s),n.onlineState=t,n.isPrimaryClient&&n.sharedClientState.setOnlineState(t)}}async function qP(i,t,e){const n=jt(i);n.sharedClientState.updateQueryState(t,"rejected",e);const s=n.Eu.get(t),r=s&&s.key;if(r){let o=new Oe(Lt.comparator);o=o.insert(r,Sn.newNoDocument(r,Wt.min()));const a=se().add(r),c=new Bl(Wt.min(),new Map,new Oe(Zt),o,a);await Pv(n,c),n.du=n.du.remove(r),n.Eu.delete(t),Ef(n)}else await ld(n.localStore,t,!1).then(()=>dd(n,t,e)).catch(go)}async function jP(i,t){const e=jt(i),n=t.batch.batchId;try{const s=await tP(e.localStore,t);Lv(e,n,null),Dv(e,n),e.sharedClientState.updateMutationState(n,"acknowledged"),await Fa(e,s)}catch(s){await go(s)}}async function KP(i,t,e){const n=jt(i);try{const s=await function(o,a){const c=jt(o);return c.persistence.runTransaction("Reject batch","readwrite-primary",l=>{let h;return c.mutationQueue.lookupMutationBatch(l,a).next(d=>(ye(d!==null,37113),h=d.keys(),c.mutationQueue.removeMutationBatch(l,d))).next(()=>c.mutationQueue.performConsistencyCheck(l)).next(()=>c.documentOverlayCache.removeOverlaysForBatchId(l,h,a)).next(()=>c.localDocuments.recalculateAndSaveOverlaysForDocumentKeys(l,h)).next(()=>c.localDocuments.getDocuments(l,h))})}(n.localStore,t);Lv(n,t,e),Dv(n,t),n.sharedClientState.updateMutationState(t,"rejected",e),await Fa(n,s)}catch(s){await go(s)}}function Dv(i,t){(i.Vu.get(t)||[]).forEach(e=>{e.resolve()}),i.Vu.delete(t)}function Lv(i,t,e){const n=jt(i);let s=n.Ru[n.currentUser.toKey()];if(s){const r=s.get(t);r&&(e?r.reject(e):r.resolve(),s=s.remove(t)),n.Ru[n.currentUser.toKey()]=s}}function dd(i,t,e=null){i.sharedClientState.removeLocalQueryTarget(t);for(const n of i.Tu.get(t))i.Pu.delete(n),e&&i.hu.pu(n,e);i.Tu.delete(t),i.isPrimaryClient&&i.Au.zr(t).forEach(n=>{i.Au.containsKey(n)||Nv(i,n)})}function Nv(i,t){i.Iu.delete(t.path.canonicalString());const e=i.du.get(t);e!==null&&(ff(i.remoteStore,e),i.du=i.du.remove(t),i.Eu.delete(e),Ef(i))}function Bg(i,t,e){for(const n of e)n instanceof Rv?(i.Au.addReference(n.key,t),$P(i,n)):n instanceof Iv?(xt(xf,"Document no longer in limbo: "+n.key),i.Au.removeReference(n.key,t),i.Au.containsKey(n.key)||Nv(i,n.key)):Ft(19791,{yu:n})}function $P(i,t){const e=t.key,n=e.path.canonicalString();i.du.get(e)||i.Iu.has(n)||(xt(xf,"New document in limbo: "+e),i.Iu.add(n),Ef(i))}function Ef(i){for(;i.Iu.size>0&&i.du.size<i.maxConcurrentLimboResolutions;){const t=i.Iu.values().next().value;i.Iu.delete(t);const e=new Lt(Ce.fromString(t)),n=i.mu.next();i.Eu.set(n,new VP(e)),i.du=i.du.insert(e,n),Tv(i.remoteStore,new as(pi(nf(e.path)),n,"TargetPurposeLimboResolution",Pl.ue))}}async function Fa(i,t,e){const n=jt(i),s=[],r=[],o=[];n.Pu.isEmpty()||(n.Pu.forEach((a,c)=>{o.push(n.gu(c,t,e).then(l=>{var h;if((l||e)&&n.isPrimaryClient){const d=l?!l.fromCache:(h=e?.targetChanges.get(c.targetId))===null||h===void 0?void 0:h.current;n.sharedClientState.updateQueryState(c.targetId,d?"current":"not-current")}if(l){s.push(l);const d=hf.Es(c.targetId,l);r.push(d)}}))}),await Promise.all(o),n.hu.J_(s),await async function(c,l){const h=jt(c);try{await h.persistence.runTransaction("notifyLocalViewChanges","readwrite",d=>tt.forEach(l,f=>tt.forEach(f.Is,p=>h.persistence.referenceDelegate.addReference(d,f.targetId,p)).next(()=>tt.forEach(f.ds,p=>h.persistence.referenceDelegate.removeReference(d,f.targetId,p)))))}catch(d){if(!_o(d))throw d;xt(df,"Failed to update sequence numbers: "+d)}for(const d of l){const f=d.targetId;if(!d.fromCache){const p=h.Fs.get(f),v=p.snapshotVersion,x=p.withLastLimboFreeSnapshotVersion(v);h.Fs=h.Fs.insert(f,x)}}}(n.localStore,r))}async function YP(i,t){const e=jt(i);if(!e.currentUser.isEqual(t)){xt(xf,"User change. New user:",t.toKey());const n=await vv(e.localStore,t);e.currentUser=t,function(r,o){r.Vu.forEach(a=>{a.forEach(c=>{c.reject(new Dt(it.CANCELLED,o))})}),r.Vu.clear()}(e,"'waitForPendingWrites' promise is rejected due to a user change."),e.sharedClientState.handleUserChange(t,n.removedBatchIds,n.addedBatchIds),await Fa(e,n.Bs)}}function JP(i,t){const e=jt(i),n=e.Eu.get(t);if(n&&n.lu)return se().add(n.key);{let s=se();const r=e.Tu.get(t);if(!r)return s;for(const o of r){const a=e.Pu.get(o);s=s.unionWith(a.view.tu)}return s}}function Uv(i){const t=jt(i);return t.remoteStore.remoteSyncer.applyRemoteEvent=Pv.bind(null,t),t.remoteStore.remoteSyncer.getRemoteKeysForTarget=JP.bind(null,t),t.remoteStore.remoteSyncer.rejectListen=qP.bind(null,t),t.hu.J_=LP.bind(null,t.eventManager),t.hu.pu=NP.bind(null,t.eventManager),t}function ZP(i){const t=jt(i);return t.remoteStore.remoteSyncer.applySuccessfulWrite=jP.bind(null,t),t.remoteStore.remoteSyncer.rejectFailedWrite=KP.bind(null,t),t}class Tl{constructor(){this.kind="memory",this.synchronizeTabs=!1}async initialize(t){this.serializer=kl(t.databaseInfo.databaseId),this.sharedClientState=this.bu(t),this.persistence=this.Du(t),await this.persistence.start(),this.localStore=this.vu(t),this.gcScheduler=this.Cu(t,this.localStore),this.indexBackfillerScheduler=this.Fu(t,this.localStore)}Cu(t,e){return null}Fu(t,e){return null}vu(t){return QC(this.persistence,new YC,t.initialUser,this.serializer)}Du(t){return new _v(uf.Vi,this.serializer)}bu(t){return new oP}async terminate(){var t,e;(t=this.gcScheduler)===null||t===void 0||t.stop(),(e=this.indexBackfillerScheduler)===null||e===void 0||e.stop(),this.sharedClientState.shutdown(),await this.persistence.shutdown()}}Tl.provider={build:()=>new Tl};class QP extends Tl{constructor(t){super(),this.cacheSizeBytes=t}Cu(t,e){ye(this.persistence.referenceDelegate instanceof xl,46915);const n=this.persistence.referenceDelegate.garbageCollector;return new UC(n,t.asyncQueue,e)}Du(t){const e=this.cacheSizeBytes!==void 0?Cn.withCacheSize(this.cacheSizeBytes):Cn.DEFAULT;return new _v(n=>xl.Vi(n,e),this.serializer)}}class fd{async initialize(t,e){this.localStore||(this.localStore=t.localStore,this.sharedClientState=t.sharedClientState,this.datastore=this.createDatastore(e),this.remoteStore=this.createRemoteStore(e),this.eventManager=this.createEventManager(e),this.syncEngine=this.createSyncEngine(e,!t.synchronizeTabs),this.sharedClientState.onlineStateHandler=n=>Vg(this.syncEngine,n,1),this.remoteStore.remoteSyncer.handleCredentialChange=YP.bind(null,this.syncEngine),await RP(this.remoteStore,this.syncEngine.isPrimaryClient))}createEventManager(t){return function(){return new CP}()}createDatastore(t){const e=kl(t.databaseInfo.databaseId),n=function(r){return new hP(r)}(t.databaseInfo);return function(r,o,a,c){return new mP(r,o,a,c)}(t.authCredentials,t.appCheckCredentials,n,e)}createRemoteStore(t){return function(n,s,r,o,a){return new _P(n,s,r,o,a)}(this.localStore,this.datastore,t.asyncQueue,e=>Vg(this.syncEngine,e,0),function(){return Dg.C()?new Dg:new aP}())}createSyncEngine(t,e){return function(s,r,o,a,c,l,h){const d=new BP(s,r,o,a,c,l);return h&&(d.fu=!0),d}(this.localStore,this.remoteStore,this.eventManager,this.sharedClientState,t.initialUser,t.maxConcurrentLimboResolutions,e)}async terminate(){var t,e;await async function(s){const r=jt(s);xt(Qs,"RemoteStore shutting down."),r.Ia.add(5),await Oa(r),r.Ea.shutdown(),r.Aa.set("Unknown")}(this.remoteStore),(t=this.datastore)===null||t===void 0||t.terminate(),(e=this.eventManager)===null||e===void 0||e.terminate()}}fd.provider={build:()=>new fd};/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *//**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class t2{constructor(t){this.observer=t,this.muted=!1}next(t){this.muted||this.observer.next&&this.xu(this.observer.next,t)}error(t){this.muted||(this.observer.error?this.xu(this.observer.error,t):Hi("Uncaught Error in snapshot listener:",t.toString()))}Ou(){this.muted=!0}xu(t,e){setTimeout(()=>{this.muted||t(e)},0)}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const As="FirestoreClient";class e2{constructor(t,e,n,s,r){this.authCredentials=t,this.appCheckCredentials=e,this.asyncQueue=n,this.databaseInfo=s,this.user=Tn.UNAUTHENTICATED,this.clientId=$d.newId(),this.authCredentialListener=()=>Promise.resolve(),this.appCheckCredentialListener=()=>Promise.resolve(),this._uninitializedComponentsProvider=r,this.authCredentials.start(n,async o=>{xt(As,"Received user=",o.uid),await this.authCredentialListener(o),this.user=o}),this.appCheckCredentials.start(n,o=>(xt(As,"Received new app check token=",o),this.appCheckCredentialListener(o,this.user)))}get configuration(){return{asyncQueue:this.asyncQueue,databaseInfo:this.databaseInfo,clientId:this.clientId,authCredentials:this.authCredentials,appCheckCredentials:this.appCheckCredentials,initialUser:this.user,maxConcurrentLimboResolutions:100}}setCredentialChangeListener(t){this.authCredentialListener=t}setAppCheckTokenChangeListener(t){this.appCheckCredentialListener=t}terminate(){this.asyncQueue.enterRestrictedMode();const t=new Xs;return this.asyncQueue.enqueueAndForgetEvenWhileRestricted(async()=>{try{this._onlineComponents&&await this._onlineComponents.terminate(),this._offlineComponents&&await this._offlineComponents.terminate(),this.authCredentials.shutdown(),this.appCheckCredentials.shutdown(),t.resolve()}catch(e){const n=vf(e,"Failed to shutdown persistence");t.reject(n)}}),t.promise}}async function Ku(i,t){i.asyncQueue.verifyOperationInProgress(),xt(As,"Initializing OfflineComponentProvider");const e=i.configuration;await t.initialize(e);let n=e.initialUser;i.setCredentialChangeListener(async s=>{n.isEqual(s)||(await vv(t.localStore,s),n=s)}),t.persistence.setDatabaseDeletedListener(()=>{vs("Terminating Firestore due to IndexedDb database deletion"),i.terminate().then(()=>{xt("Terminating Firestore due to IndexedDb database deletion completed successfully")}).catch(s=>{vs("Terminating Firestore due to IndexedDb database deletion failed",s)})}),i._offlineComponents=t}async function kg(i,t){i.asyncQueue.verifyOperationInProgress();const e=await n2(i);xt(As,"Initializing OnlineComponentProvider"),await t.initialize(e,i.configuration),i.setCredentialChangeListener(n=>Ng(t.remoteStore,n)),i.setAppCheckTokenChangeListener((n,s)=>Ng(t.remoteStore,s)),i._onlineComponents=t}async function n2(i){if(!i._offlineComponents)if(i._uninitializedComponentsProvider){xt(As,"Using user provided OfflineComponentProvider");try{await Ku(i,i._uninitializedComponentsProvider._offline)}catch(t){const e=t;if(!function(s){return s.name==="FirebaseError"?s.code===it.FAILED_PRECONDITION||s.code===it.UNIMPLEMENTED:!(typeof DOMException<"u"&&s instanceof DOMException)||s.code===22||s.code===20||s.code===11}(e))throw e;vs("Error using user provided cache. Falling back to memory cache: "+e),await Ku(i,new Tl)}}else xt(As,"Using default OfflineComponentProvider"),await Ku(i,new QP(void 0));return i._offlineComponents}async function Ov(i){return i._onlineComponents||(i._uninitializedComponentsProvider?(xt(As,"Using user provided OnlineComponentProvider"),await kg(i,i._uninitializedComponentsProvider._online)):(xt(As,"Using default OnlineComponentProvider"),await kg(i,new fd))),i._onlineComponents}function i2(i){return Ov(i).then(t=>t.syncEngine)}async function zg(i){const t=await Ov(i),e=t.eventManager;return e.onListen=kP.bind(null,t.syncEngine),e.onUnlisten=GP.bind(null,t.syncEngine),e.onFirstRemoteStoreListen=zP.bind(null,t.syncEngine),e.onLastRemoteStoreUnlisten=WP.bind(null,t.syncEngine),e}/**
 * @license
 * Copyright 2023 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Fv(i){const t={};return i.timeoutSeconds!==void 0&&(t.timeoutSeconds=i.timeoutSeconds),t}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Hg=new Map;/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Vv="firestore.googleapis.com",Gg=!0;class Wg{constructor(t){var e,n;if(t.host===void 0){if(t.ssl!==void 0)throw new Dt(it.INVALID_ARGUMENT,"Can't provide ssl option if host option is not set");this.host=Vv,this.ssl=Gg}else this.host=t.host,this.ssl=(e=t.ssl)!==null&&e!==void 0?e:Gg;if(this.isUsingEmulator=t.emulatorOptions!==void 0,this.credentials=t.credentials,this.ignoreUndefinedProperties=!!t.ignoreUndefinedProperties,this.localCache=t.localCache,t.cacheSizeBytes===void 0)this.cacheSizeBytes=gv;else{if(t.cacheSizeBytes!==-1&&t.cacheSizeBytes<LC)throw new Dt(it.INVALID_ARGUMENT,"cacheSizeBytes must be at least 1048576");this.cacheSizeBytes=t.cacheSizeBytes}_I("experimentalForceLongPolling",t.experimentalForceLongPolling,"experimentalAutoDetectLongPolling",t.experimentalAutoDetectLongPolling),this.experimentalForceLongPolling=!!t.experimentalForceLongPolling,this.experimentalForceLongPolling?this.experimentalAutoDetectLongPolling=!1:t.experimentalAutoDetectLongPolling===void 0?this.experimentalAutoDetectLongPolling=!0:this.experimentalAutoDetectLongPolling=!!t.experimentalAutoDetectLongPolling,this.experimentalLongPollingOptions=Fv((n=t.experimentalLongPollingOptions)!==null&&n!==void 0?n:{}),function(r){if(r.timeoutSeconds!==void 0){if(isNaN(r.timeoutSeconds))throw new Dt(it.INVALID_ARGUMENT,`invalid long polling timeout: ${r.timeoutSeconds} (must not be NaN)`);if(r.timeoutSeconds<5)throw new Dt(it.INVALID_ARGUMENT,`invalid long polling timeout: ${r.timeoutSeconds} (minimum allowed value is 5)`);if(r.timeoutSeconds>30)throw new Dt(it.INVALID_ARGUMENT,`invalid long polling timeout: ${r.timeoutSeconds} (maximum allowed value is 30)`)}}(this.experimentalLongPollingOptions),this.useFetchStreams=!!t.useFetchStreams}isEqual(t){return this.host===t.host&&this.ssl===t.ssl&&this.credentials===t.credentials&&this.cacheSizeBytes===t.cacheSizeBytes&&this.experimentalForceLongPolling===t.experimentalForceLongPolling&&this.experimentalAutoDetectLongPolling===t.experimentalAutoDetectLongPolling&&function(n,s){return n.timeoutSeconds===s.timeoutSeconds}(this.experimentalLongPollingOptions,t.experimentalLongPollingOptions)&&this.ignoreUndefinedProperties===t.ignoreUndefinedProperties&&this.useFetchStreams===t.useFetchStreams}}class Gl{constructor(t,e,n,s){this._authCredentials=t,this._appCheckCredentials=e,this._databaseId=n,this._app=s,this.type="firestore-lite",this._persistenceKey="(lite)",this._settings=new Wg({}),this._settingsFrozen=!1,this._emulatorOptions={},this._terminateTask="notTerminated"}get app(){if(!this._app)throw new Dt(it.FAILED_PRECONDITION,"Firestore was not initialized using the Firebase SDK. 'app' is not available");return this._app}get _initialized(){return this._settingsFrozen}get _terminated(){return this._terminateTask!=="notTerminated"}_setSettings(t){if(this._settingsFrozen)throw new Dt(it.FAILED_PRECONDITION,"Firestore has already been started and its settings can no longer be changed. You can only modify settings before calling any other methods on a Firestore object.");this._settings=new Wg(t),this._emulatorOptions=t.emulatorOptions||{},t.credentials!==void 0&&(this._authCredentials=function(n){if(!n)return new cI;switch(n.type){case"firstParty":return new dI(n.sessionIndex||"0",n.iamToken||null,n.authTokenFactory||null);case"provider":return n.client;default:throw new Dt(it.INVALID_ARGUMENT,"makeAuthCredentialsProvider failed due to invalid credential type")}}(t.credentials))}_getSettings(){return this._settings}_getEmulatorOptions(){return this._emulatorOptions}_freezeSettings(){return this._settingsFrozen=!0,this._settings}_delete(){return this._terminateTask==="notTerminated"&&(this._terminateTask=this._terminate()),this._terminateTask}async _restart(){this._terminateTask==="notTerminated"?await this._terminate():this._terminateTask="notTerminated"}toJSON(){return{app:this._app,databaseId:this._databaseId,settings:this._settings}}_terminate(){return function(e){const n=Hg.get(e);n&&(xt("ComponentProvider","Removing Datastore"),Hg.delete(e),n.terminate())}(this),Promise.resolve()}}function s2(i,t,e,n={}){var s;i=qs(i,Gl);const r=qd(t),o=i._getSettings(),a=Object.assign(Object.assign({},o),{emulatorOptions:i._getEmulatorOptions()}),c=`${t}:${e}`;r&&(F1(`https://${c}`),z1("Firestore",!0)),o.host!==Vv&&o.host!==c&&vs("Host has been set in both settings() and connectFirestoreEmulator(), emulator host will be used.");const l=Object.assign(Object.assign({},o),{host:c,ssl:r,emulatorOptions:n});if(!ul(l,a)&&(i._setSettings(l),n.mockUserToken)){let h,d;if(typeof n.mockUserToken=="string")h=n.mockUserToken,d=Tn.MOCK_USER;else{h=V1(n.mockUserToken,(s=i._app)===null||s===void 0?void 0:s.options.projectId);const f=n.mockUserToken.sub||n.mockUserToken.user_id;if(!f)throw new Dt(it.INVALID_ARGUMENT,"mockUserToken must contain 'sub' or 'user_id' field!");d=new Tn(f)}i._authCredentials=new lI(new b0(h,d))}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Wl{constructor(t,e,n){this.converter=e,this._query=n,this.type="query",this.firestore=t}withConverter(t){return new Wl(this.firestore,t,this._query)}}class Je{constructor(t,e,n){this.converter=e,this._key=n,this.type="document",this.firestore=t}get _path(){return this._key.path}get id(){return this._key.path.lastSegment()}get path(){return this._key.path.canonicalString()}get parent(){return new ps(this.firestore,this.converter,this._key.path.popLast())}withConverter(t){return new Je(this.firestore,t,this._key)}toJSON(){return{type:Je._jsonSchemaVersion,referencePath:this._key.toString()}}static fromJSON(t,e,n){if(La(e,Je._jsonSchema))return new Je(t,n||null,new Lt(Ce.fromString(e.referencePath)))}}Je._jsonSchemaVersion="firestore/documentReference/1.0",Je._jsonSchema={type:qe("string",Je._jsonSchemaVersion),referencePath:qe("string")};class ps extends Wl{constructor(t,e,n){super(t,e,nf(n)),this._path=n,this.type="collection"}get id(){return this._query.path.lastSegment()}get path(){return this._query.path.canonicalString()}get parent(){const t=this._path.popLast();return t.isEmpty()?null:new Je(this.firestore,null,new Lt(t))}withConverter(t){return new ps(this.firestore,t,this._path)}}function r2(i,t,...e){if(i=io(i),I0("collection","path",t),i instanceof Gl){const n=Ce.fromString(t,...e);return ig(n),new ps(i,null,n)}{if(!(i instanceof Je||i instanceof ps))throw new Dt(it.INVALID_ARGUMENT,"Expected first argument to collection() to be a CollectionReference, a DocumentReference or FirebaseFirestore");const n=i._path.child(Ce.fromString(t,...e));return ig(n),new ps(i.firestore,null,n)}}function o2(i,t,...e){if(i=io(i),arguments.length===1&&(t=$d.newId()),I0("doc","path",t),i instanceof Gl){const n=Ce.fromString(t,...e);return ng(n),new Je(i,null,new Lt(n))}{if(!(i instanceof Je||i instanceof ps))throw new Dt(it.INVALID_ARGUMENT,"Expected first argument to collection() to be a CollectionReference, a DocumentReference or FirebaseFirestore");const n=i._path.child(Ce.fromString(t,...e));return ng(n),new Je(i.firestore,i instanceof ps?i.converter:null,new Lt(n))}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Xg="AsyncQueue";class qg{constructor(t=Promise.resolve()){this.Zu=[],this.Xu=!1,this.ec=[],this.tc=null,this.nc=!1,this.rc=!1,this.sc=[],this.F_=new xv(this,"async_queue_retry"),this.oc=()=>{const n=ju();n&&xt(Xg,"Visibility state changed to "+n.visibilityState),this.F_.y_()},this._c=t;const e=ju();e&&typeof e.addEventListener=="function"&&e.addEventListener("visibilitychange",this.oc)}get isShuttingDown(){return this.Xu}enqueueAndForget(t){this.enqueue(t)}enqueueAndForgetEvenWhileRestricted(t){this.ac(),this.uc(t)}enterRestrictedMode(t){if(!this.Xu){this.Xu=!0,this.rc=t||!1;const e=ju();e&&typeof e.removeEventListener=="function"&&e.removeEventListener("visibilitychange",this.oc)}}enqueue(t){if(this.ac(),this.Xu)return new Promise(()=>{});const e=new Xs;return this.uc(()=>this.Xu&&this.rc?Promise.resolve():(t().then(e.resolve,e.reject),e.promise)).then(()=>e.promise)}enqueueRetryable(t){this.enqueueAndForget(()=>(this.Zu.push(t),this.cc()))}async cc(){if(this.Zu.length!==0){try{await this.Zu[0](),this.Zu.shift(),this.F_.reset()}catch(t){if(!_o(t))throw t;xt(Xg,"Operation failed with retryable error: "+t)}this.Zu.length>0&&this.F_.g_(()=>this.cc())}}uc(t){const e=this._c.then(()=>(this.nc=!0,t().catch(n=>{throw this.tc=n,this.nc=!1,Hi("INTERNAL UNHANDLED ERROR: ",jg(n)),n}).then(n=>(this.nc=!1,n))));return this._c=e,e}enqueueAfterDelay(t,e,n){this.ac(),this.sc.indexOf(t)>-1&&(e=0);const s=_f.createAndSchedule(this,t,e,n,r=>this.lc(r));return this.ec.push(s),s}ac(){this.tc&&Ft(47125,{hc:jg(this.tc)})}verifyOperationInProgress(){}async Pc(){let t;do t=this._c,await t;while(t!==this._c)}Tc(t){for(const e of this.ec)if(e.timerId===t)return!0;return!1}Ic(t){return this.Pc().then(()=>{this.ec.sort((e,n)=>e.targetTimeMs-n.targetTimeMs);for(const e of this.ec)if(e.skipDelay(),t!=="all"&&e.timerId===t)break;return this.Pc()})}dc(t){this.sc.push(t)}lc(t){const e=this.ec.indexOf(t);this.ec.splice(e,1)}}function jg(i){let t=i.message||"";return i.stack&&(t=i.stack.includes(i.message)?i.stack:i.message+`
`+i.stack),t}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Kg(i){return function(e,n){if(typeof e!="object"||e===null)return!1;const s=e;for(const r of n)if(r in s&&typeof s[r]=="function")return!0;return!1}(i,["next","error","complete"])}class Ra extends Gl{constructor(t,e,n,s){super(t,e,n,s),this.type="firestore",this._queue=new qg,this._persistenceKey=s?.name||"[DEFAULT]"}async _terminate(){if(this._firestoreClient){const t=this._firestoreClient.terminate();this._queue=new qg(t),this._firestoreClient=void 0,await t}}}function a2(i,t){const e=typeof i=="object"?i:JR(),n=typeof i=="string"?i:pl,s=qR(e,"firestore").getImmediate({identifier:n});if(!s._initialized){const r=U1("firestore");r&&s2(s,...r)}return s}function Bv(i){if(i._terminated)throw new Dt(it.FAILED_PRECONDITION,"The client has already been terminated.");return i._firestoreClient||c2(i),i._firestoreClient}function c2(i){var t,e,n;const s=i._freezeSettings(),r=function(a,c,l,h){return new RI(a,c,l,h.host,h.ssl,h.experimentalForceLongPolling,h.experimentalAutoDetectLongPolling,Fv(h.experimentalLongPollingOptions),h.useFetchStreams,h.isUsingEmulator)}(i._databaseId,((t=i._app)===null||t===void 0?void 0:t.options.appId)||"",i._persistenceKey,s);i._componentsProvider||!((e=s.localCache)===null||e===void 0)&&e._offlineComponentProvider&&(!((n=s.localCache)===null||n===void 0)&&n._onlineComponentProvider)&&(i._componentsProvider={_offline:s.localCache._offlineComponentProvider,_online:s.localCache._onlineComponentProvider}),i._firestoreClient=new e2(i._authCredentials,i._appCheckCredentials,i._queue,r,i._componentsProvider&&function(a){const c=a?._online.build();return{_offline:a?._offline.build(c),_online:c}}(i._componentsProvider))}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Wn{constructor(t){this._byteString=t}static fromBase64String(t){try{return new Wn(pn.fromBase64String(t))}catch(e){throw new Dt(it.INVALID_ARGUMENT,"Failed to construct data from Base64 string: "+e)}}static fromUint8Array(t){return new Wn(pn.fromUint8Array(t))}toBase64(){return this._byteString.toBase64()}toUint8Array(){return this._byteString.toUint8Array()}toString(){return"Bytes(base64: "+this.toBase64()+")"}isEqual(t){return this._byteString.isEqual(t._byteString)}toJSON(){return{type:Wn._jsonSchemaVersion,bytes:this.toBase64()}}static fromJSON(t){if(La(t,Wn._jsonSchema))return Wn.fromBase64String(t.bytes)}}Wn._jsonSchemaVersion="firestore/bytes/1.0",Wn._jsonSchema={type:qe("string",Wn._jsonSchemaVersion),bytes:qe("string")};/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Tf{constructor(...t){for(let e=0;e<t.length;++e)if(t[e].length===0)throw new Dt(it.INVALID_ARGUMENT,"Invalid field name at argument $(i + 1). Field names must not be empty.");this._internalPath=new dn(t)}isEqual(t){return this._internalPath.isEqual(t._internalPath)}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Sf{constructor(t){this._methodName=t}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class _i{constructor(t,e){if(!isFinite(t)||t<-90||t>90)throw new Dt(it.INVALID_ARGUMENT,"Latitude must be a number between -90 and 90, but was: "+t);if(!isFinite(e)||e<-180||e>180)throw new Dt(it.INVALID_ARGUMENT,"Longitude must be a number between -180 and 180, but was: "+e);this._lat=t,this._long=e}get latitude(){return this._lat}get longitude(){return this._long}isEqual(t){return this._lat===t._lat&&this._long===t._long}_compareTo(t){return Zt(this._lat,t._lat)||Zt(this._long,t._long)}toJSON(){return{latitude:this._lat,longitude:this._long,type:_i._jsonSchemaVersion}}static fromJSON(t){if(La(t,_i._jsonSchema))return new _i(t.latitude,t.longitude)}}_i._jsonSchemaVersion="firestore/geoPoint/1.0",_i._jsonSchema={type:qe("string",_i._jsonSchemaVersion),latitude:qe("number"),longitude:qe("number")};/**
 * @license
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class vi{constructor(t){this._values=(t||[]).map(e=>e)}toArray(){return this._values.map(t=>t)}isEqual(t){return function(n,s){if(n.length!==s.length)return!1;for(let r=0;r<n.length;++r)if(n[r]!==s[r])return!1;return!0}(this._values,t._values)}toJSON(){return{type:vi._jsonSchemaVersion,vectorValues:this._values}}static fromJSON(t){if(La(t,vi._jsonSchema)){if(Array.isArray(t.vectorValues)&&t.vectorValues.every(e=>typeof e=="number"))return new vi(t.vectorValues);throw new Dt(it.INVALID_ARGUMENT,"Expected 'vectorValues' field to be a number array")}}}vi._jsonSchemaVersion="firestore/vectorValue/1.0",vi._jsonSchema={type:qe("string",vi._jsonSchemaVersion),vectorValues:qe("object")};/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const l2=/^__.*__$/;class u2{constructor(t,e,n){this.data=t,this.fieldMask=e,this.fieldTransforms=n}toMutation(t,e){return this.fieldMask!==null?new nr(t,this.data,this.fieldMask,e,this.fieldTransforms):new Na(t,this.data,e,this.fieldTransforms)}}function kv(i){switch(i){case 0:case 2:case 1:return!0;case 3:case 4:return!1;default:throw Ft(40011,{Ec:i})}}class Af{constructor(t,e,n,s,r,o){this.settings=t,this.databaseId=e,this.serializer=n,this.ignoreUndefinedProperties=s,r===void 0&&this.Ac(),this.fieldTransforms=r||[],this.fieldMask=o||[]}get path(){return this.settings.path}get Ec(){return this.settings.Ec}Rc(t){return new Af(Object.assign(Object.assign({},this.settings),t),this.databaseId,this.serializer,this.ignoreUndefinedProperties,this.fieldTransforms,this.fieldMask)}Vc(t){var e;const n=(e=this.path)===null||e===void 0?void 0:e.child(t),s=this.Rc({path:n,mc:!1});return s.fc(t),s}gc(t){var e;const n=(e=this.path)===null||e===void 0?void 0:e.child(t),s=this.Rc({path:n,mc:!1});return s.Ac(),s}yc(t){return this.Rc({path:void 0,mc:!0})}wc(t){return Sl(t,this.settings.methodName,this.settings.Sc||!1,this.path,this.settings.bc)}contains(t){return this.fieldMask.find(e=>t.isPrefixOf(e))!==void 0||this.fieldTransforms.find(e=>t.isPrefixOf(e.field))!==void 0}Ac(){if(this.path)for(let t=0;t<this.path.length;t++)this.fc(this.path.get(t))}fc(t){if(t.length===0)throw this.wc("Document fields must not be empty");if(kv(this.Ec)&&l2.test(t))throw this.wc('Document fields cannot begin and end with "__"')}}class h2{constructor(t,e,n){this.databaseId=t,this.ignoreUndefinedProperties=e,this.serializer=n||kl(t)}Dc(t,e,n,s=!1){return new Af({Ec:t,methodName:e,bc:n,path:dn.emptyPath(),mc:!1,Sc:s},this.databaseId,this.serializer,this.ignoreUndefinedProperties)}}function d2(i){const t=i._freezeSettings(),e=kl(i._databaseId);return new h2(i._databaseId,!!t.ignoreUndefinedProperties,e)}function f2(i,t,e,n,s,r={}){const o=i.Dc(r.merge||r.mergeFields?2:0,t,e,s);Wv("Data must be an object, but it was:",o,n);const a=Hv(n,o);let c,l;if(r.merge)c=new ri(o.fieldMask),l=o.fieldTransforms;else if(r.mergeFields){const h=[];for(const d of r.mergeFields){const f=p2(t,d,e);if(!o.contains(f))throw new Dt(it.INVALID_ARGUMENT,`Field '${f}' is specified in your field mask but missing from your input data.`);g2(h,f)||h.push(f)}c=new ri(h),l=o.fieldTransforms.filter(d=>c.covers(d.field))}else c=null,l=o.fieldTransforms;return new u2(new Gn(a),c,l)}class Mf extends Sf{constructor(t,e){super(t),this.Cc=e}_toFieldTransform(t){const e=new ba(t.serializer,Q0(t.serializer,this.Cc));return new tC(t.path,e)}isEqual(t){return t instanceof Mf&&this.Cc===t.Cc}}function zv(i,t){if(Gv(i=io(i)))return Wv("Unsupported field value:",t,i),Hv(i,t);if(i instanceof Sf)return function(n,s){if(!kv(s.Ec))throw s.wc(`${n._methodName}() can only be used with update() and set()`);if(!s.path)throw s.wc(`${n._methodName}() is not currently supported inside arrays`);const r=n._toFieldTransform(s);r&&s.fieldTransforms.push(r)}(i,t),null;if(i===void 0&&t.ignoreUndefinedProperties)return null;if(t.path&&t.fieldMask.push(t.path),i instanceof Array){if(t.settings.mc&&t.Ec!==4)throw t.wc("Nested arrays are not supported");return function(n,s){const r=[];let o=0;for(const a of n){let c=zv(a,s.yc(o));c==null&&(c={nullValue:"NULL_VALUE"}),r.push(c),o++}return{arrayValue:{values:r}}}(i,t)}return function(n,s){if((n=io(n))===null)return{nullValue:"NULL_VALUE"};if(typeof n=="number")return Q0(s.serializer,n);if(typeof n=="boolean")return{booleanValue:n};if(typeof n=="string")return{stringValue:n};if(n instanceof Date){const r=Pe.fromDate(n);return{timestampValue:yl(s.serializer,r)}}if(n instanceof Pe){const r=new Pe(n.seconds,1e3*Math.floor(n.nanoseconds/1e3));return{timestampValue:yl(s.serializer,r)}}if(n instanceof _i)return{geoPointValue:{latitude:n.latitude,longitude:n.longitude}};if(n instanceof Wn)return{bytesValue:lv(s.serializer,n._byteString)};if(n instanceof Je){const r=s.databaseId,o=n.firestore._databaseId;if(!o.isEqual(r))throw s.wc(`Document reference is for database ${o.projectId}/${o.database} but should be for database ${r.projectId}/${r.database}`);return{referenceValue:cf(n.firestore._databaseId||s.databaseId,n._key.path)}}if(n instanceof vi)return function(o,a){return{mapValue:{fields:{[V0]:{stringValue:B0},[ml]:{arrayValue:{values:o.toArray().map(l=>{if(typeof l!="number")throw a.wc("VectorValues must only contain numeric values.");return sf(a.serializer,l)})}}}}}}(n,s);throw s.wc(`Unsupported field value: ${Yd(n)}`)}(i,t)}function Hv(i,t){const e={};return D0(i)?t.path&&t.path.length>0&&t.fieldMask.push(t.path):tr(i,(n,s)=>{const r=zv(s,t.Vc(n));r!=null&&(e[n]=r)}),{mapValue:{fields:e}}}function Gv(i){return!(typeof i!="object"||i===null||i instanceof Array||i instanceof Date||i instanceof Pe||i instanceof _i||i instanceof Wn||i instanceof Je||i instanceof Sf||i instanceof vi)}function Wv(i,t,e){if(!Gv(e)||!C0(e)){const n=Yd(e);throw n==="an object"?t.wc(i+" a custom object"):t.wc(i+" "+n)}}function p2(i,t,e){if((t=io(t))instanceof Tf)return t._internalPath;if(typeof t=="string")return Xv(i,t);throw Sl("Field path arguments must be of type string or ",i,!1,void 0,e)}const m2=new RegExp("[~\\*/\\[\\]]");function Xv(i,t,e){if(t.search(m2)>=0)throw Sl(`Invalid field path (${t}). Paths must not contain '~', '*', '/', '[', or ']'`,i,!1,void 0,e);try{return new Tf(...t.split("."))._internalPath}catch{throw Sl(`Invalid field path (${t}). Paths must not be empty, begin with '.', end with '.', or contain '..'`,i,!1,void 0,e)}}function Sl(i,t,e,n,s){const r=n&&!n.isEmpty(),o=s!==void 0;let a=`Function ${t}() called with invalid data`;e&&(a+=" (via `toFirestore()`)"),a+=". ";let c="";return(r||o)&&(c+=" (found",r&&(c+=` in field ${n}`),o&&(c+=` in document ${s}`),c+=")"),new Dt(it.INVALID_ARGUMENT,a+i+c)}function g2(i,t){return i.some(e=>e.isEqual(t))}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class qv{constructor(t,e,n,s,r){this._firestore=t,this._userDataWriter=e,this._key=n,this._document=s,this._converter=r}get id(){return this._key.path.lastSegment()}get ref(){return new Je(this._firestore,this._converter,this._key)}exists(){return this._document!==null}data(){if(this._document){if(this._converter){const t=new _2(this._firestore,this._userDataWriter,this._key,this._document,null);return this._converter.fromFirestore(t)}return this._userDataWriter.convertValue(this._document.data.value)}}get(t){if(this._document){const e=this._document.data.field(jv("DocumentSnapshot.get",t));if(e!==null)return this._userDataWriter.convertValue(e)}}}class _2 extends qv{data(){return super.data()}}function jv(i,t){return typeof t=="string"?Xv(i,t):t instanceof Tf?t._internalPath:t._delegate._internalPath}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function v2(i){if(i.limitType==="L"&&i.explicitOrderBy.length===0)throw new Dt(it.UNIMPLEMENTED,"limitToLast() queries require specifying at least one orderBy() clause")}class y2{convertValue(t,e="none"){switch(Ts(t)){case 0:return null;case 1:return t.booleanValue;case 2:return ke(t.integerValue||t.doubleValue);case 3:return this.convertTimestamp(t.timestampValue);case 4:return this.convertServerTimestamp(t,e);case 5:return t.stringValue;case 6:return this.convertBytes(Es(t.bytesValue));case 7:return this.convertReference(t.referenceValue);case 8:return this.convertGeoPoint(t.geoPointValue);case 9:return this.convertArray(t.arrayValue,e);case 11:return this.convertObject(t.mapValue,e);case 10:return this.convertVectorValue(t.mapValue);default:throw Ft(62114,{value:t})}}convertObject(t,e){return this.convertObjectMap(t.fields,e)}convertObjectMap(t,e="none"){const n={};return tr(t,(s,r)=>{n[s]=this.convertValue(r,e)}),n}convertVectorValue(t){var e,n,s;const r=(s=(n=(e=t.fields)===null||e===void 0?void 0:e[ml].arrayValue)===null||n===void 0?void 0:n.values)===null||s===void 0?void 0:s.map(o=>ke(o.doubleValue));return new vi(r)}convertGeoPoint(t){return new _i(ke(t.latitude),ke(t.longitude))}convertArray(t,e){return(t.values||[]).map(n=>this.convertValue(n,e))}convertServerTimestamp(t,e){switch(e){case"previous":const n=Ll(t);return n==null?null:this.convertValue(n,e);case"estimate":return this.convertTimestamp(Ta(t));default:return null}}convertTimestamp(t){const e=xs(t);return new Pe(e.seconds,e.nanos)}convertDocumentKey(t,e){const n=Ce.fromString(t);ye(mv(n),9688,{name:t});const s=new Sa(n.get(1),n.get(3)),r=new Lt(n.popFirst(5));return s.isEqual(e)||Hi(`Document ${r} contains a document reference within a different database (${s.projectId}/${s.database}) which is not supported. It will be treated as a reference in the current database (${e.projectId}/${e.database}) instead.`),r}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function x2(i,t,e){let n;return n=i?e&&(e.merge||e.mergeFields)?i.toFirestore(t,e):i.toFirestore(t):t,n}class Yo{constructor(t,e){this.hasPendingWrites=t,this.fromCache=e}isEqual(t){return this.hasPendingWrites===t.hasPendingWrites&&this.fromCache===t.fromCache}}class js extends qv{constructor(t,e,n,s,r,o){super(t,e,n,s,o),this._firestore=t,this._firestoreImpl=t,this.metadata=r}exists(){return super.exists()}data(t={}){if(this._document){if(this._converter){const e=new $c(this._firestore,this._userDataWriter,this._key,this._document,this.metadata,null);return this._converter.fromFirestore(e,t)}return this._userDataWriter.convertValue(this._document.data.value,t.serverTimestamps)}}get(t,e={}){if(this._document){const n=this._document.data.field(jv("DocumentSnapshot.get",t));if(n!==null)return this._userDataWriter.convertValue(n,e.serverTimestamps)}}toJSON(){if(this.metadata.hasPendingWrites)throw new Dt(it.FAILED_PRECONDITION,"DocumentSnapshot.toJSON() attempted to serialize a document with pending writes. Await waitForPendingWrites() before invoking toJSON().");const t=this._document,e={};return e.type=js._jsonSchemaVersion,e.bundle="",e.bundleSource="DocumentSnapshot",e.bundleName=this._key.toString(),!t||!t.isValidDocument()||!t.isFoundDocument()?e:(this._userDataWriter.convertObjectMap(t.data.value.mapValue.fields,"previous"),e.bundle=(this._firestore,this.ref.path,"NOT SUPPORTED"),e)}}js._jsonSchemaVersion="firestore/documentSnapshot/1.0",js._jsonSchema={type:qe("string",js._jsonSchemaVersion),bundleSource:qe("string","DocumentSnapshot"),bundleName:qe("string"),bundle:qe("string")};class $c extends js{data(t={}){return super.data(t)}}class Xr{constructor(t,e,n,s){this._firestore=t,this._userDataWriter=e,this._snapshot=s,this.metadata=new Yo(s.hasPendingWrites,s.fromCache),this.query=n}get docs(){const t=[];return this.forEach(e=>t.push(e)),t}get size(){return this._snapshot.docs.size}get empty(){return this.size===0}forEach(t,e){this._snapshot.docs.forEach(n=>{t.call(e,new $c(this._firestore,this._userDataWriter,n.key,n,new Yo(this._snapshot.mutatedKeys.has(n.key),this._snapshot.fromCache),this.query.converter))})}docChanges(t={}){const e=!!t.includeMetadataChanges;if(e&&this._snapshot.excludesMetadataChanges)throw new Dt(it.INVALID_ARGUMENT,"To include metadata changes with your document changes, you must also pass { includeMetadataChanges:true } to onSnapshot().");return this._cachedChanges&&this._cachedChangesIncludeMetadataChanges===e||(this._cachedChanges=function(s,r){if(s._snapshot.oldDocs.isEmpty()){let o=0;return s._snapshot.docChanges.map(a=>{const c=new $c(s._firestore,s._userDataWriter,a.doc.key,a.doc,new Yo(s._snapshot.mutatedKeys.has(a.doc.key),s._snapshot.fromCache),s.query.converter);return a.doc,{type:"added",doc:c,oldIndex:-1,newIndex:o++}})}{let o=s._snapshot.oldDocs;return s._snapshot.docChanges.filter(a=>r||a.type!==3).map(a=>{const c=new $c(s._firestore,s._userDataWriter,a.doc.key,a.doc,new Yo(s._snapshot.mutatedKeys.has(a.doc.key),s._snapshot.fromCache),s.query.converter);let l=-1,h=-1;return a.type!==0&&(l=o.indexOf(a.doc.key),o=o.delete(a.doc.key)),a.type!==1&&(o=o.add(a.doc),h=o.indexOf(a.doc.key)),{type:E2(a.type),doc:c,oldIndex:l,newIndex:h}})}}(this,e),this._cachedChangesIncludeMetadataChanges=e),this._cachedChanges}toJSON(){if(this.metadata.hasPendingWrites)throw new Dt(it.FAILED_PRECONDITION,"QuerySnapshot.toJSON() attempted to serialize a document with pending writes. Await waitForPendingWrites() before invoking toJSON().");const t={};t.type=Xr._jsonSchemaVersion,t.bundleSource="QuerySnapshot",t.bundleName=$d.newId(),this._firestore._databaseId.database,this._firestore._databaseId.projectId;const e=[],n=[],s=[];return this.docs.forEach(r=>{r._document!==null&&(e.push(r._document),n.push(this._userDataWriter.convertObjectMap(r._document.data.value.mapValue.fields,"previous")),s.push(r.ref.path))}),t.bundle=(this._firestore,this.query._query,t.bundleName,"NOT SUPPORTED"),t}}function E2(i){switch(i){case 0:return"added";case 2:case 3:return"modified";case 1:return"removed";default:return Ft(61501,{type:i})}}Xr._jsonSchemaVersion="firestore/querySnapshot/1.0",Xr._jsonSchema={type:qe("string",Xr._jsonSchemaVersion),bundleSource:qe("string","QuerySnapshot"),bundleName:qe("string"),bundle:qe("string")};class Kv extends y2{constructor(t){super(),this.firestore=t}convertBytes(t){return new Wn(t)}convertReference(t){const e=this.convertDocumentKey(t,this.firestore._databaseId);return new Je(this.firestore,null,e)}}function T2(i,t,e){i=qs(i,Je);const n=qs(i.firestore,Ra),s=x2(i.converter,t,e);return $v(n,[f2(d2(n),"setDoc",i._key,s,i.converter!==null,e).toMutation(i._key,mi.none())])}function bD(i){return $v(qs(i.firestore,Ra),[new rf(i._key,mi.none())])}function S2(i,...t){var e,n,s;i=io(i);let r={includeMetadataChanges:!1,source:"default"},o=0;typeof t[o]!="object"||Kg(t[o])||(r=t[o++]);const a={includeMetadataChanges:r.includeMetadataChanges,source:r.source};if(Kg(t[o])){const d=t[o];t[o]=(e=d.next)===null||e===void 0?void 0:e.bind(d),t[o+1]=(n=d.error)===null||n===void 0?void 0:n.bind(d),t[o+2]=(s=d.complete)===null||s===void 0?void 0:s.bind(d)}let c,l,h;if(i instanceof Je)l=qs(i.firestore,Ra),h=nf(i._key.path),c={next:d=>{t[o]&&t[o](A2(l,i,d))},error:t[o+1],complete:t[o+2]};else{const d=qs(i,Wl);l=qs(d.firestore,Ra),h=d._query;const f=new Kv(l);c={next:p=>{t[o]&&t[o](new Xr(l,f,d,p))},error:t[o+1],complete:t[o+2]},v2(i._query)}return function(f,p,v,x){const m=new t2(x),_=new UP(p,m,v);return f.asyncQueue.enqueueAndForget(async()=>PP(await zg(f),_)),()=>{m.Ou(),f.asyncQueue.enqueueAndForget(async()=>DP(await zg(f),_))}}(Bv(l),h,a,c)}function $v(i,t){return function(n,s){const r=new Xs;return n.asyncQueue.enqueueAndForget(async()=>XP(await i2(n),s,r)),r.promise}(Bv(i),t)}function A2(i,t,e){const n=e.docs.get(t._key),s=new Kv(i);return new js(i,s,t._key,n,new Yo(e.hasPendingWrites,e.fromCache),t.converter)}function RD(i){return new Mf("increment",i)}(function(t,e=!0){(function(s){mo=s})(YR),dl(new ya("firestore",(n,{instanceIdentifier:s,options:r})=>{const o=n.getProvider("app").getImmediate(),a=new Ra(new uI(n.getProvider("auth-internal")),new fI(o,n.getProvider("app-check-internal")),function(l,h){if(!Object.prototype.hasOwnProperty.apply(l.options,["projectId"]))throw new Dt(it.INVALID_ARGUMENT,'"projectId" not provided in firebase.initializeApp.');return new Sa(l.options.projectId,h)}(o,s),o);return r=Object.assign({useFetchStreams:e},r),a._setSettings(r),a},"PUBLIC").setMultipleInstances(!0)),Gr(Jm,Zm,t),Gr(Jm,Zm,"esm2017")})();var M2="firebase",w2="11.10.0";/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */Gr(M2,w2,"app");const b2={apiKey:"AIzaSyAA1hn-j9_pPuXoaHIzcyyXYJN6EhUccJU",authDomain:"amen-farms-app.firebaseapp.com",projectId:"amen-farms-app",storageBucket:"amen-farms-app.firebasestorage.app",messagingSenderId:"321230755979",appId:"1:321230755979:web:d362c56aaf7e50b4ab5c8e"},R2="amenfarms";function I2(i){let t=0;for(const e of i.toLowerCase())t=t*31+e.charCodeAt(0)>>>0;return"fam"+t.toString(36)}function C2(){try{const i=new URLSearchParams(location.search).get("fam");if(i)return i}catch{}return I2(R2)}function ID(){try{const i=localStorage.getItem("choreUser");if(i&&i.trim())return i.trim()}catch{}return"Farmer"}let $u=null;function P2(){return $u||($u=(async()=>{try{const i=_0(b2,"farmlife"),t=a2(i);return{app:i,db:t}}catch(i){return console.warn("Farm Life: Firestore init failed — playing offline.",i),null}})()),$u.then(i=>i?{...i,familyKey:C2()}:null)}function D2(i){return`farmlife_${i}`}const L2=12e3;class CD{constructor(t){Bn(this,"ready");Bn(this,"db",null);Bn(this,"colName","");Bn(this,"offline",!1);Bn(this,"serverConfirmed",!1);Bn(this,"latestDocs",[]);Bn(this,"listeners",new Set);Bn(this,"unsub",null);Bn(this,"onOffline");this.onOffline=t??null,this.ready=this.init()}async init(){const t=await P2();return t?(this.db=t.db,this.colName=D2(t.familyKey),new Promise(e=>{let n=!1;const s=o=>{n||(n=!0,clearTimeout(r),o||(this.offline=!0,this.onOffline?.("Playing offline — this device only")),e(o))},r=window.setTimeout(()=>s(!1),L2);try{this.unsub=S2(r2(this.db,this.colName),o=>{if(this.latestDocs=o.docs.map(a=>({id:a.id,data:a.data()})),o.metadata.fromCache||(this.serverConfirmed=!0,s(!0)),this.serverConfirmed)for(const a of this.listeners)a(this.latestDocs,{fromCache:o.metadata.fromCache})},o=>{console.warn("Farm Life: Firestore snapshot error — playing offline.",o),s(!1)})}catch(o){console.warn("Farm Life: Firestore subscribe failed — playing offline.",o),s(!1)}})):(this.offline=!0,this.onOffline?.("Playing offline — this device only"),!1)}docs(){return this.latestDocs}onChange(t){return this.listeners.add(t),()=>this.listeners.delete(t)}async write(t,e){if(!(this.offline||!this.db))try{await T2(o2(this.db,this.colName,t),e,{merge:!0})}catch(n){console.warn(`Farm Life: write to ${t} failed (will retry on next change).`,n)}}dispose(){this.unsub?.(),this.listeners.clear()}}const Yv="world";function Yu(i){const t=i.find(n=>n.id===Yv);if(!t||!t.data)return Ws();const e=t.data.data;if(typeof e!="string"||e==="default"||!e)return Ws();try{return W_(JSON.parse(e))}catch{return Ws()}}class PD{constructor(t){Bn(this,"ready");Bn(this,"session");this.session=t,this.ready=t.ready}async load(){return await this.ready,this.session.offline?Ws():Yu(this.session.docs())}current(){return Yu(this.session.docs())}save(t){if(this.session.offline)return Promise.resolve();const e=X_(t),n=eb(t)?"default":JSON.stringify(e);return this.session.write(Yv,{data:n,updatedAt:Date.now()})}subscribe(t){return this.session.onChange(e=>t(Yu(e)))}}const N2={tree:{label:"Tree",emoji:"🌳",size:[3,4,3],collide:"circle",cf:.22},pine:{label:"Pine",emoji:"🌲",size:[3,5,3],collide:"circle",cf:.22},bush:{label:"Bush",emoji:"🌿",size:[2,1.4,2],collide:"circle",cf:.4},rock:{label:"Rock",emoji:"🪨",size:[1.6,1.4,1.6],collide:"circle",cf:.42},barn:{label:"Barn",emoji:"🏠",size:[8,6,6],collide:"box"},shed:{label:"Shed",emoji:"🛖",size:[4,3.4,4],collide:"box"},silo:{label:"Silo",emoji:"🥫",size:[3,7,3],collide:"circle",cf:.45},hay:{label:"Hay bale",emoji:"🌾",size:[1.8,1.4,2.2],collide:"circle",cf:.45},log:{label:"Log",emoji:"🪵",size:[3,1,1],collide:"circle",cf:.42},flower:{label:"Flowers",emoji:"🌷",size:[1.6,.8,1.6],collide:"none"},path:{label:"Path tile",emoji:"⬜",size:[2,.25,2],collide:"none"}},DD=Object.keys(N2);function U2(i,t,e){const n=t||e!=null&&e<1;return new gs({color:i,transparent:n,opacity:e??(t?.55:1),depthWrite:!(e!=null&&e<1)})}const O2={barn:"buildings/barn.glb",shed:"buildings/shed.glb",silo:"buildings/silo.glb"},wf=new Map;let Jv=!1;function LD(){return Promise.all(Object.entries(O2).map(async([i,t])=>{const e=await Q_(e0(t));wf.set(i,e)})).then(()=>{Jv=!0})}function ND(){return Jv}function UD(i){return!!wf.get(i)}function OD(i,t=!1){const e=t?null:wf.get(i);if(e){const r=new Xe;return r.userData.glb=!0,r.add(t0(e).root),r}const n=new Xe,s=(r,o,a=0,c=0,l=0,h)=>{const d=new ve(r,U2(o,t,h));return d.position.set(a,c,l),d.castShadow=!0,d.receiveShadow=!0,n.add(d),d};switch(i){case"tree":{s(new ti(.09,.13,.55,6),7293484,0,-.22,0),s(new ui(.34,10,8),5209402,0,.12,0),s(new ui(.26,10,8),6262854,.15,.28,-.1);break}case"pine":{s(new ti(.08,.11,.4,6),7293484,0,-.3,0),s(new sl(.34,.5,8),4157236,0,0,0),s(new sl(.26,.4,8),4881725,0,.28,0);break}case"bush":{s(new ui(.42,10,8),5211191,0,-.05,0),s(new ui(.32,10,8),6067778,.22,.08,.12),s(new ui(.3,10,8),6067778,-.22,.05,-.1);break}case"rock":{s(new pa(.5,0),9145227,0,-.02,0).scale.set(1,.72,1),s(new pa(.26,0),10132122,.28,-.18,.2);break}case"barn":{s(new We(1,.62,1),11747375,0,-.19,0);const r=s(new We(.76,.06,1.04),8010538,-.2,.28,0);r.rotation.z=.72;const o=s(new We(.76,.06,1.04),8010538,.2,.28,0);o.rotation.z=-.72,s(new We(.3,.36,.04),15328472,0,-.32,.5);break}case"shed":{s(new We(1,.6,1),13279338,0,-.2,0);const r=s(new We(1.1,.08,1.1),7031339,0,.16,0);r.rotation.z=.16,s(new We(.26,.32,.04),8016432,0,-.34,.5);break}case"silo":{s(new ti(.42,.42,.82,16),13225166,0,-.09,0),s(new ui(.42,16,8,0,Math.PI*2,0,Math.PI/2),11449270,0,.32,0);break}case"hay":{const r=s(new ti(.45,.45,.9,14),14204764,0,0,0);r.rotation.z=Math.PI/2,s(new rl(.46,.04,6,16),12098106,0,0,.28).rotation.y=Math.PI/2,s(new rl(.46,.04,6,16),12098106,0,0,-.28).rotation.y=Math.PI/2;break}case"log":{const r=s(new ti(.28,.28,1,10),7293484,0,-.22,0);r.rotation.z=Math.PI/2,s(new ti(.2,.2,1.02,8),9070146,0,-.22,0).rotation.z=Math.PI/2;break}case"flower":{s(new bl(.5,12),7313994,0,-.48,0).rotation.x=-Math.PI/2;const r=[15231631,15909198,9399016,15695178];let o=7;const a=()=>(o=o*1103515245+12345&2147483647)/2147483647;for(let c=0;c<6;c++){const l=(a()-.5)*.7,h=(a()-.5)*.7;s(new ti(.015,.015,.3,4),5211191,l,-.33,h),s(new ui(.07,6,5),r[c%r.length],l,-.16,h)}break}case"path":{s(new We(1,1,1),10260352);break}default:s(new We(1,1,1),13148266,0,0,0,t?.5:1)}return n}function FD(i,t){const e=new Xe,n=i.points;if(!n||n.length<2)return e;const s=i.height||1.3,r=i.postGap||2.5,o=1.2,a=new gs({color:8016432}),c=new gs({color:9069110}),l=[.42,.72],h=[];for(let x=0;x<n.length-1;x++){const m=n[x],_=n[x+1],A=_.x-m.x,S=_.z-m.z,b=Math.hypot(A,S),F=Math.max(1,Math.round(b/o));for(let N=0;N<F;N++){const M=N/F,w=m.x+A*M,C=m.z+S*M;h.push({x:w,z:C,y:t(w,C)})}}const d=n[n.length-1];h.push({x:d.x,z:d.z,y:t(d.x,d.z)});const f=new O(0,0,1);for(let x=0;x<h.length-1;x++){const m=h[x],_=h[x+1];for(const A of l){const S=new O(_.x-m.x,_.y+s*A-(m.y+s*A),_.z-m.z),b=S.length()||.01;S.normalize();const F=new ve(new We(.08,.11,b),c);F.position.set((m.x+_.x)/2,(m.y+_.y)/2+s*A,(m.z+_.z)/2),F.quaternion.setFromUnitVectors(f,S),F.castShadow=!0,e.add(F)}}let p=0,v=0;for(let x=0;x<h.length;x++)if(x>0&&(p+=Math.hypot(h[x].x-h[x-1].x,h[x].z-h[x-1].z)),p>=v||x===h.length-1){const m=h[x],_=new ve(new We(.16,s,.16),a);_.position.set(m.x,m.y+s/2,m.z),_.castShadow=!0,e.add(_),v+=r}return e}export{WM as $,W2 as A,We as B,j2 as C,ei as D,ai as E,we as F,Xe as G,G2 as H,N2 as I,MD as J,Ws as K,I_ as L,V2 as M,eb as N,Me as O,Us as P,oi as Q,Ca as R,q2 as S,B2 as T,De as U,O as V,k2 as W,ob as X,OD as Y,FD as Z,K_ as _,dt as a,lD as a$,H2 as a0,OM as a1,sl as a2,gs as a3,Q_ as a4,e0 as a5,tD as a6,Qw as a7,nD as a8,Xy as a9,uD as aA,Hs as aB,Cl as aC,U_ as aD,Ud as aE,os as aF,hi as aG,Nm as aH,zd as aI,_b as aJ,eD as aK,Ti as aL,on as aM,C_ as aN,GM as aO,gy as aP,A_ as aQ,SD as aR,LD as aS,J2 as aT,Ke as aU,Y2 as aV,Q2 as aW,ED as aX,ND as aY,UD as aZ,TD as a_,ge as aa,Wd as ab,cD as ac,xD as ad,iD as ae,aD as af,C2 as ag,ID as ah,P2 as ai,o2 as aj,T2 as ak,bD as al,RD as am,An as an,gb as ao,i0 as ap,n0 as aq,pD as ar,gD as as,_D as at,mD as au,fD as av,Um as aw,an as ax,bl as ay,r0 as az,Tx as b,dD as b0,s0 as b1,oD as b2,Pm as b3,hD as b4,vD as b5,sD as b6,rD as b7,o1 as b8,yD as b9,_1 as ba,ts as bb,no as bc,Z2 as bd,X2 as c,ks as d,ti as e,mn as f,ve as g,B_ as h,Dd as i,rl as j,ui as k,Gt as l,us as m,CD as n,PD as o,A1 as p,hn as q,z2 as r,K2 as s,It as t,Bw as u,Pn as v,AD as w,$2 as x,_s as y,DD as z};
