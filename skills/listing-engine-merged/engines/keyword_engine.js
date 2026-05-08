/**
 * engines/keyword_engine.js — STUB
 * Keyword extraction moved to layer3_market layer
 */
'use strict';
module.exports = {
  run: function(schema, step4) {
    schema = schema || {};
    const raw = schema.raw || {};
    const title = raw.title || '';
    const words = title.toLowerCase().split(/\s+/).filter(function(w) {
      return w.length > 3 && !('the,for,and,with,from,this,that,for,you,your'.split(',').indexOf(w) >= 0);
    });
    const primary = words.slice(0, 5).map(function(w) { return { keyword: w }; });
    const competitorCount = (step4 && step4.filteredCompetitors) ? step4.filteredCompetitors.length : 0;
    return {
      keywords: {
        primary: primary,
        secondary: [],
        backend: [],
        sizeSignals: [],
        competitorCount: competitorCount
      }
    };
  }
};