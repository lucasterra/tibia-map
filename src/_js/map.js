(function() {
	function TibiaMap() {
		this.map = null;
		this.floor = 7;
		this.mapFloors = [];
		this.mapDataStore = [];
		this.waypoints = [];
	}
	var URL_PREFIX = 'https://tibiamaps.github.io/tibia-map-data/mapper/';
	// `KNOWN_TILES` is a placeholder for the whitelist of known tiles:
	// https://tibiamaps.github.io/tibia-map-data/mapper/tiles.json
	var KNOWN_TILES = null;
	var fetchKnownTiles = function() {
		var xhr = new XMLHttpRequest();
		xhr.open('GET', URL_PREFIX + 'tiles.json', true);
		xhr.responseType = 'json';
		xhr.onload = function() {
			if (xhr.status == 200) {
				KNOWN_TILES = new Set(xhr.response);
			}
		};
		xhr.send();
	};
	fetchKnownTiles();
	// https://github.com/tibiamaps/tibia-maps-script/blob/master/src/colors.js
	var MAP_COLORS = {
		0x00: { r: 0, g: 0, b: 0 }, // black (empty)
		0x0C: { r: 0, g: 102, b: 0 }, // dark green (trees)
		0x18: { r: 0, g: 204, b: 0 }, // green (grass)
		0x1E: { r: 0, g: 255, b: 0 }, // light green (old swamp)
		0x33: { r: 51, g: 102, b: 153 }, // light blue (water)
		0x56: { r: 102, g: 102, b: 102 }, // dark gray (stone/mountains)
		0x72: { r: 153, g: 51, b: 0 }, // dark brown (earth/stalagmites)
		0x79: { r: 153, g: 102, b: 51 }, // brown (earth)
		0x81: { r: 153, g: 153, b: 153 }, // gray (floor)
		0x8C: { r: 153, g: 255, b: 102 }, // light green (light spots in grassy areas)
		0xB3: { r: 204, g: 255, b: 255 }, // light blue (ice)
		0xBA: { r: 255, g: 51, b: 0 }, // red (city/walls)
		0xC0: { r: 255, g: 102, b: 0 }, // orange (lava)
		0xCF: { r: 255, g: 204, b: 153 }, // beige (sand)
		0xD2: { r: 255, g: 255, b: 0 }, // yellow (ladders/holes/…)
		0xD7: { r: 255, g: 255, b: 255 } // white (snow / target?)
	};
	var BLANK_COLOR = MAP_COLORS[0x00];
	var EMPTY_MAP_DATA = new Uint8Array(new ArrayBuffer(256 * 256));
	var padNumber = function(number, size) {
		var s = '000' + String(number);
		return s.substr(s.length - size);
	};
	var setUrlPosition = function(coords) {
		var url = '#' + coords.x + ',' + coords.y + ',' + coords.floor + ':' + coords.zoom;
		window.history.pushState(null, null, url);
	};
	var getUrlPosition = function() {
		var position = {
			'x': 32368,
			'y': 32198,
			'floor': 7,
			'zoom': 0
		};
		var parts = window.location.hash.slice(1).split(':');
		if (parts[0]) {
			var tempPos = parts[0].split(',');
			if (tempPos.length == 3) {
				position.x = parseInt(tempPos[0], 10);
				position.y = parseInt(tempPos[1], 10);
				position.floor = parseInt(tempPos[2], 10);
			}
		}
		if (parts[1]) {
			position.zoom = parseInt(parts[1], 10);
		}
		return position;
	};
	var modifyLeaflet = function() {
		L.CRS.CustomZoom = L.extend({}, L.CRS.Simple, {
			'scale': function(zoom) {
				switch (zoom) {
					case 0:
						return 256;
					case 1:
						return 512;
					case 2:
						return 1792;
					case 3:
						return 5120;
					case 4:
						return 10240;
					default:
						return 256;
				}
			},
			'latLngToPoint': function(latlng, zoom) {
				var projectedPoint = this.projection.project(latlng);
				var scale = this.scale(zoom);
				return this.transformation._transform(projectedPoint, scale);
			},
			'pointToLatLng': function(point, zoom) {
				var scale = this.scale(zoom);
				var untransformedPoint = this.transformation.untransform(point, scale);
				return this.projection.unproject(untransformedPoint);
			}
		});
	};
	TibiaMap.prototype._getMapData = function(x, y, z, callback) {
		var mapName = padNumber(x, 3) + padNumber(y, 3) + padNumber(z, 2);
		var dataStore = this.mapDataStore;
		if (dataStore[mapName]) {
			window.requestAnimationFrame(function() {
				callback(dataStore[mapName]);
			});
		} else {
			// Only fetch the map file if it’s in the whitelist, or if the whitelist
			// has not finished loading yet.
			if (!KNOWN_TILES || KNOWN_TILES.has(mapName)) {
				var xhr = new XMLHttpRequest();
				xhr.open('GET', URL_PREFIX + mapName + '.map', true);
				xhr.responseType = 'arraybuffer';
				xhr.onload = function(exception) {
					var mapData;
					if (this.status == 200) {
						mapData = new Uint8Array(this.response);
					} else {
						mapData = EMPTY_MAP_DATA;
					}
					dataStore[mapName] = mapData;
					callback(mapData);
				};
				xhr.send();
			}
		}
	};
	TibiaMap.prototype._createMapImageData = function(imageData, baseX, baseY, baseZ, callback) {
		this._getMapData(baseX, baseY, baseZ, function(mapData) {
			var index = 0;
			for (var x = 0; x < 256; x++) {
				for (var y = 0; y < 256; y++) {
					var data = mapData[index];
					var color = MAP_COLORS[data] || BLANK_COLOR;
					var base = (y * imageData.width + x) * 4;
					imageData.data[base + 0] = color.r;
					imageData.data[base + 1] = color.g;
					imageData.data[base + 2] = color.b;
					imageData.data[base + 3] = 255;
					++index;
				}
			}
			callback(imageData);
		});
	};
	TibiaMap.prototype._createMapFloorLayer = function(floor) {
		var mapLayer = this.mapFloors[floor] = new L.GridLayer();
		var map = this.map;
		var _this = this;
		mapLayer._getTileSize = function() {
			return L.CRS.CustomZoom.scale(map.getZoom())
		};
		mapLayer._setZoomTransform = function(level, center, zoom) {
			var coords = getUrlPosition();
			coords.zoom = zoom;
			setUrlPosition(coords);
			var scale = this._map.getZoomScale(zoom, level.zoom);
			var translate = level.origin.multiplyBy(scale).subtract(
				this._map._getNewPixelOrigin(center, zoom)
			).round();
			L.DomUtil.setTransform(level.el, translate, scale);
		};
		mapLayer.createTile = function(coords, done) {
			var tile = document.createElement('canvas');
			tile.width = tile.height = 256;
			var ctx = tile.getContext('2d');
			var data = ctx.createImageData(256, 256);
			_this._createMapImageData(data, coords.x, coords.y, floor, function(image) {
				ctx.putImageData(image, 0, 0);
				ctx.imageSmoothingEnabled = false;
				done(null, tile);
			});
			return tile;
		};
		return mapLayer;
	};
	TibiaMap.prototype._showHoverTile = function() {
		var map = this.map;
		var _this = this;
		map.on('mouseout', function(event) {
			_this.hoverTile.setBounds([
				[0, 0],
				[0, 0]
			]);
		});
		map.on('mousemove', function(event) {
			var pos = map.project(event.latlng, 0);
			var x = Math.floor(pos.x);
			var y = Math.floor(pos.y);
			var bounds = [map.unproject([x, y], 0), map.unproject([x + 1, y + 1], 0)];
			if (!_this.hoverTile) {
				_this.hoverTile = L.rectangle(bounds, {
					'color': '#009eff',
					'weight': 1,
					'clickable': false,
					'pointerEvents': 'none'
				}).addTo(map);
			} else {
				_this.hoverTile.setBounds(bounds);
			}
		});
	};
	TibiaMap.prototype.init = function() {
		var _this = this;
		modifyLeaflet();
		// Taken from https://tibiamaps.github.io/tibia-map-data/bounds.json, which
		// rarely (if ever) changes.
		var bounds = { 'xMin': 124, 'xMax': 131, 'yMin': 121, 'yMax': 128 };
		var xPadding = window.innerWidth / 256 / 2;
		var yPadding = window.innerHeight / 256 / 2;
		var yMin = bounds.yMin - yPadding;
		var xMin = bounds.xMin - xPadding;
		var yMax = bounds.yMax + 1 + yPadding;
		var xMax = bounds.xMax + 1 + xPadding;
		var maxBounds = L.latLngBounds(L.latLng(-yMin, xMin), L.latLng(-yMax, xMax));
		var map = this.map = L.map('map', {
			'fadeAnimation': false,
			'minZoom': 0,
			'maxZoom': 4,
			'maxNativeZoom': 0,
			'zoomAnimationThreshold': 4,
			'fullscreenControl': true,
			'attributionControl': false,
			'keyboardPanOffset': 200,
			'unloadInvisibleTiles': false,
			'updateWhenIdle': true,
			'keyboardPanOffset': 500,
			'crs': L.CRS.CustomZoom,
			'maxBounds': maxBounds
		});
		var baseMaps = {
			'Floor +7': this._createMapFloorLayer(0),
			'Floor +6': this._createMapFloorLayer(1),
			'Floor +5': this._createMapFloorLayer(2),
			'Floor +4': this._createMapFloorLayer(3),
			'Floor +3': this._createMapFloorLayer(4),
			'Floor +2': this._createMapFloorLayer(5),
			'Floor +1': this._createMapFloorLayer(6),
			'Ground floor': this._createMapFloorLayer(7),
			'Floor -1': this._createMapFloorLayer(8),
			'Floor -2': this._createMapFloorLayer(9),
			'Floor -3': this._createMapFloorLayer(10),
			'Floor -4': this._createMapFloorLayer(11),
			'Floor -5': this._createMapFloorLayer(12),
			'Floor -6': this._createMapFloorLayer(13),
			'Floor -7': this._createMapFloorLayer(14),
			'Floor -8': this._createMapFloorLayer(15)
		};
		L.control.layers(baseMaps, {}).addTo(map);
		var current = getUrlPosition();
		_this.floor = current.floor;
		map.setView(map.unproject([current.x, current.y], 0), current.zoom);
		this.mapFloors[current.floor].addTo(map);
		window.addEventListener('popstate', function(event) {
			var current = getUrlPosition();
			if (current.floor !== _this.floor) {
				_this.floor = current.floor;
				this.mapFloors[_this.floor].addTo(map);
			}
			if (current.zoom !== map.getZoom()) {
				map.setZoom(current.zoom);
			}
			map.panTo(map.unproject([current.x, current.y], 0));
		});
		map.on('baselayerchange', function(layer) {
			for (var i = 0; i <= 15; i++) {
				if (_this.mapFloors[i]._leaflet_id == layer._leaflet_id) {
					_this.floor = i;
					break;
				}
			};
		});
		map.on('click', function(event) {
			var coords = L.CRS.CustomZoom.latLngToPoint(event.latlng, 0);
			var zoom = map.getZoom();
			var coordX = Math.floor(Math.abs(coords.x));
			var coordY = Math.floor(Math.abs(coords.y));
			setUrlPosition({
				'x': coordX,
				'y': coordY,
				'floor': _this.floor,
				'zoom': zoom
			});
		});
		L.crosshairs().addTo(map);
		L.control.coordinates({
			'position': 'bottomleft',
			'enableUserInput': false,
			'labelFormatterLat': function(lat) {
				var coordX = Math.floor(Math.abs(lat * 256));
				return '<b>Y</b>: ' + coordX + ' <b>Z</b>: ' + _this.floor;
			},
			'labelFormatterLng': function(lng) {
				var coordY = Math.floor(Math.abs(lng * 256));
				return '<b>X</b>: ' + coordY;
			}
		}).addTo(map);
		_this._showHoverTile();
	};

	var map = new TibiaMap();
	map.init();

}());