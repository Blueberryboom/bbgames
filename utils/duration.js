function parseDhms(input) {
  if (!input) return null;
  const value = String(input).trim().toLowerCase();
  const matches = [...value.matchAll(/(\d+)\s*([dhms])/g)];
  if (!matches.length) return null;

  let ms = 0;
  for (const match of matches) {
    const amount = Number(match[1]);
    const unit = match[2];
    if (!Number.isFinite(amount) || amount < 0) return null;
    if (unit === 'd') ms += amount * 24 * 60 * 60 * 1000;
    if (unit === 'h') ms += amount * 60 * 60 * 1000;
    if (unit === 'm') ms += amount * 60 * 1000;
    if (unit === 's') ms += amount * 1000;
  }

  const stripped = value.replace(/(\d+)\s*[dhms]/g, '').trim();
  if (stripped.length) return null;
  return ms;
}

module.exports = { parseDhms };
