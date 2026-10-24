import { Router } from 'express';
import { listDevices } from '../device/platforms.js';

export default function deviceRoutes() {
  const r = Router();
  // ?platform=iOS | Android (bỏ trống = tất cả)
  r.get('/devices', async (req, res, next) => {
    try { res.json(await listDevices(req.query.platform || undefined)); } catch (e) { next(e); }
  });
  return r;
}
