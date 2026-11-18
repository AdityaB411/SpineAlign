/* Web Bluetooth transport for SpineAlign. Loaded before app.js without overwriting navigator.serial. */
(() => {
  'use strict';

  const SERVICE_UUID = '67b7a001-9b7c-4eb7-a1a8-6b7f51a0a101';
  const CHARACTERISTIC_UUID = '67b7a002-9b7c-4eb7-a1a8-6b7f51a0a101';
  const encoder = new TextEncoder();

  function isSupported() {
    return Boolean(typeof window !== 'undefined' && window.isSecureContext && typeof navigator !== 'undefined' && navigator.bluetooth);
  }

  async function requestBleDevice() {
    if (!window.isSecureContext) {
      throw new Error('Bluetooth requires HTTPS or localhost.');
    }
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth is unavailable in this browser. Use Chrome or Edge over HTTPS or localhost, or switch to Wi-Fi.');
    }

    let device = null;
    try {
      device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [SERVICE_UUID] }],
        optionalServices: [SERVICE_UUID]
      });
      const gatt = await device.gatt.connect();
      const service = await gatt.getPrimaryService(SERVICE_UUID);
      const ch = await service.getCharacteristic(CHARACTERISTIC_UUID);
      const decoder = new TextDecoder();
      const portListeners = new Map();
      let controller = null;
      let closed = false;
      let closing = false;

      function emit(type, event) {
        for (const cb of portListeners.get(type) || []) {
          try { cb(event); } catch (_) {}
        }
      }

      function closeController() {
        if (controller && !closed) {
          try { controller.close(); } catch (_) {}
          closed = true;
        }
      }

      const port = {
        transport: 'ble',
        deviceName: device.name || 'SpineAlign BLE',
        readable: new ReadableStream({
          start(c) { controller = c; },
          cancel() { closeController(); }
        }),
        writable: new WritableStream({
          async write(chunk) {
            if (!device?.gatt?.connected) {
              throw new Error('Bluetooth device is not connected.');
            }
            const data = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
            const bytes = encoder.encode(data);
            if (typeof ch.writeValueWithResponse === 'function') {
              await ch.writeValueWithResponse(bytes);
            } else {
              await ch.writeValue(bytes);
            }
          }
        }),
        addEventListener(type, cb) {
          if (!portListeners.has(type)) portListeners.set(type, new Set());
          portListeners.get(type).add(cb);
        },
        removeEventListener(type, cb) {
          portListeners.get(type)?.delete(cb);
        },
        async open() {},
        async close() {
          closing = true;
          ch.removeEventListener('characteristicvaluechanged', onValue);
          device.removeEventListener('gattserverdisconnected', onGattDisconnected);
          try { await ch.stopNotifications(); } catch (_) {}
          try { if (device?.gatt?.connected) device.gatt.disconnect(); } catch (_) {}
          closeController();
          window.__SpineAlignBleConnected = false;
        }
      };

      function onValue(event) {
        if (!controller || closed) return;
        const v = event.target.value;
        const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
        try {
          const text = decoder.decode(bytes,{stream:true});
          if (text) controller.enqueue(text);
        } catch (_) {}
      }

      function onGattDisconnected() {
        window.__SpineAlignBleConnected = false;
        closeController();
        if (!closing) {
          emit('disconnect', { target: port });
        }
      }

      await ch.startNotifications();
      ch.addEventListener('characteristicvaluechanged', onValue);
      device.addEventListener('gattserverdisconnected', onGattDisconnected);

      window.__SpineAlignBleConnected = true;
      window.__SpineAlignBleDevice = device;
      window.__SpineAlignBleCharacteristic = ch;
      window.__SpineAlignBleTransport = 'ble';
      return port;
    } catch (error) {
      try { if (device?.gatt?.connected) device.gatt.disconnect(); } catch (_) {}
      throw error;
    }
  }

  window.SpineAlignBle = Object.freeze({
    SERVICE_UUID,
    CHARACTERISTIC_UUID,
    isSupported,
    requestBleDevice
  });

  window.addEventListener('beforeunload', () => {
    try {
      if (window.__SpineAlignBleDevice?.gatt?.connected) {
        window.__SpineAlignBleDevice.gatt.disconnect();
      }
    } catch (_) {}
  });
})();
