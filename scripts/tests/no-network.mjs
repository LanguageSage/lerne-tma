// Preloaded in every Node test worker before application imports.
import { Socket } from 'node:net';
import { Socket as DatagramSocket } from 'node:dgram';

function blocked() {
  throw new Error('Network disabled in isolated tests');
}

Socket.prototype.connect = blocked;
DatagramSocket.prototype.send = blocked;
globalThis.fetch = async () => blocked();
