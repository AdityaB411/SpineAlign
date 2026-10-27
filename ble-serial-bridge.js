/* Web Bluetooth transport for SpineAlign. Loaded before app.js. ?transport=usb uses native Web Serial. */
(() => {
  'use strict';
  if(new URLSearchParams(location.search).get('transport')==='usb') return;
  const SERVICE_UUID='67b7a001-9b7c-4eb7-a1a8-6b7f51a0a101';
  const CHARACTERISTIC_UUID='67b7a002-9b7c-4eb7-a1a8-6b7f51a0a101';
  const encoder=new TextEncoder(), listeners=new Map();
  function dispatch(type,event){for(const cb of listeners.get(type)||[])cb(event);}
  async function requestBleDevice(){
    if(!window.isSecureContext)throw new Error('Bluetooth requires HTTPS or localhost.');
    if(!navigator.bluetooth)throw new Error('Web Bluetooth is unavailable here. Try Chrome/Edge over HTTPS.');
    let device=null;
    try{
      device=await navigator.bluetooth.requestDevice({filters:[{services:[SERVICE_UUID]}],optionalServices:[SERVICE_UUID]});
      const gatt=await device.gatt.connect();
      const service=await gatt.getPrimaryService(SERVICE_UUID);
      const ch=await service.getCharacteristic(CHARACTERISTIC_UUID);
      const decoder=new TextDecoder();let controller=null,closed=false,closing=false;
      const port={
        readable:new ReadableStream({start(c){controller=c;},cancel(){}}),
        writable:new WritableStream({async write(chunk){
          const data=typeof chunk==='string'?chunk:new TextDecoder().decode(chunk), bytes=encoder.encode(data);
          if(typeof ch.writeValueWithResponse==='function')await ch.writeValueWithResponse(bytes);else await ch.writeValue(bytes);
        }}),
        async open(){},
        async close(){
          closing=true;ch.removeEventListener('characteristicvaluechanged',onValue);
          try{await ch.stopNotifications();}catch(_){}
          try{if(device?.gatt?.connected)device.gatt.disconnect();}catch(_){}
          if(controller&&!closed){try{controller.close();closed=true;}catch(_){}}
          window.__SpineAlignBleConnected=false;
        }
      };
      function onValue(event){
        if(!controller||closed)return;
        const v=event.target.value,bytes=new Uint8Array(v.buffer,v.byteOffset,v.byteLength);
        try{const text=decoder.decode(bytes,{stream:true});if(text)controller.enqueue(text);}catch(_){}
      }
      await ch.startNotifications();ch.addEventListener('characteristicvaluechanged',onValue);
      device.addEventListener('gattserverdisconnected',()=>{window.__SpineAlignBleConnected=false;if(!closing)dispatch('disconnect',{target:port});});
      window.__SpineAlignBleConnected=true;window.__SpineAlignBleDevice=device;
      window.__SpineAlignBleCharacteristic=ch;window.__SpineAlignBleTransport='ble';
      return port;
    }catch(error){try{if(device?.gatt?.connected)device.gatt.disconnect();}catch(_){}throw error;}
  }
  const shim={
    async requestPort(){return requestBleDevice();},
    addEventListener(type,cb){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(cb);},
    removeEventListener(type,cb){listeners.get(type)?.delete(cb);}
  };
  try{Object.defineProperty(navigator,'serial',{configurable:true,value:shim});}
  catch(error){console.error('Could not install SpineAlign BLE bridge:',error);}
  const ids=['topConnectionText','connectionType','deviceStatusSubtitle','deviceNote'];
  function updateLabels(){
    if(!window.__SpineAlignBleConnected)return;
    for(const id of ids){
      const el=document.getElementById(id);if(!el)continue;
      const old=el.textContent,newText=old.replaceAll('USB connected','Bluetooth connected')
       .replaceAll('USB serial · 115200 baud','Bluetooth Low Energy')
       .replaceAll('over USB serial','over Bluetooth Low Energy').replaceAll('over USB','over Bluetooth');
      if(old!==newText)el.textContent=newText;
    }
  }
  document.addEventListener('DOMContentLoaded',()=>{const obs=new MutationObserver(updateLabels);obs.observe(document.body,{subtree:true,childList:true,characterData:true});updateLabels();},{once:true});
  window.addEventListener('beforeunload',()=>{try{if(window.__SpineAlignBleDevice?.gatt?.connected)window.__SpineAlignBleDevice.gatt.disconnect();}catch(_){}});
})();
