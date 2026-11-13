const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ mensaje: 'pendiente' });
});

module.exports = router;
