//just error cdes, irrelevent for now.
function requireAuth(req, res, next) 
{
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

function requireAdmin(req, res, next) 
{
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function requireStaff(req, res, next) 
{
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (req.session.role !== 'staff' && req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Staff access required' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, requireStaff };
