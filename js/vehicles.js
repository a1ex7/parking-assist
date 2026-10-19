/* Пресеты автомобилей. Данные приблизительные (открытые источники), размеры в метрах.
   turningCircle — паспортный диаметр разворота «от бордюра до бордюра» по наружному переднему колесу. */
window.PA = window.PA || {};

PA.vehicles = (function () {
  const presets = [
    { id: 'smart',    name: 'Smart ForTwo',              length: 2.695, width: 1.663, wheelbase: 1.873, track: 1.47, frontOverhang: 0.47, turningCircle: 6.95, steeringTurns: 3.0, style: 'micro' },
    { id: 'solaris',  name: 'Hyundai Solaris / Kia Rio', length: 4.40,  width: 1.74,  wheelbase: 2.60,  track: 1.51, frontOverhang: 0.83, turningCircle: 10.4, steeringTurns: 2.8, style: 'sedan' },
    { id: 'vesta',    name: 'Lada Vesta',                length: 4.41,  width: 1.764, wheelbase: 2.635, track: 1.51, frontOverhang: 0.86, turningCircle: 11.2, steeringTurns: 2.7, style: 'sedan' },
    { id: 'golf',     name: 'Volkswagen Golf 8',         length: 4.284, width: 1.789, wheelbase: 2.636, track: 1.55, frontOverhang: 0.89, turningCircle: 10.9, steeringTurns: 2.8, style: 'hatch' },
    { id: 'octavia',  name: 'Škoda Octavia A8',          length: 4.689, width: 1.829, wheelbase: 2.686, track: 1.54, frontOverhang: 0.92, turningCircle: 11.1, steeringTurns: 2.8, style: 'sedan' },
    { id: 'camry',    name: 'Toyota Camry XV70',         length: 4.885, width: 1.84,  wheelbase: 2.825, track: 1.59, frontOverhang: 0.98, turningCircle: 11.4, steeringTurns: 2.9, style: 'sedan' },
    { id: 'model3',   name: 'Tesla Model 3',             length: 4.72,  width: 1.85,  wheelbase: 2.875, track: 1.58, frontOverhang: 0.85, turningCircle: 11.7, steeringTurns: 2.5, style: 'sedan', glassRoof: true },
    { id: 'rav4',     name: 'Toyota RAV4 XA50',          length: 4.60,  width: 1.855, wheelbase: 2.69,  track: 1.61, frontOverhang: 0.925, turningCircle: 11.0, steeringTurns: 2.8, style: 'suv' },
    { id: 'lc300',    name: 'Toyota Land Cruiser 300',   length: 4.985, width: 1.98,  wheelbase: 2.85,  track: 1.66, frontOverhang: 0.93, turningCircle: 11.8, steeringTurns: 3.2, style: 'suv' },
    { id: 'sclass',   name: 'Mercedes-Benz S-Class W223', length: 5.179, width: 1.954, wheelbase: 3.106, track: 1.66, frontOverhang: 0.97, turningCircle: 12.3, steeringTurns: 2.6, style: 'sedan' },
    { id: 'multivan', name: 'Volkswagen Multivan T7',    length: 4.973, width: 1.941, wheelbase: 3.124, track: 1.66, frontOverhang: 0.90, turningCircle: 11.8, steeringTurns: 3.0, style: 'van' },
    { id: 'f150',     name: 'Ford F-150 SuperCrew',      length: 5.885, width: 2.03,  wheelbase: 3.683, track: 1.74, frontOverhang: 0.95, turningCircle: 14.6, steeringTurns: 3.4, style: 'pickup' },
  ];

  /** Производные параметры: свесы, минимальный радиус и максимальный угол колёс. */
  function derive(spec) {
    const L = spec.wheelbase;
    const rearOverhang = Math.max(0.1, spec.length - L - spec.frontOverhang);
    const rOuter = Math.max(spec.turningCircle / 2, L + 0.3);
    const rRear = Math.max(0.5, Math.sqrt(rOuter * rOuter - L * L) - spec.track / 2);
    const maxSteer = Math.atan(L / rRear);
    return {
      ...spec,
      rearOverhang,
      minRadiusRear: rRear,
      maxSteer,
      maxWheelAngle: spec.steeringTurns * Math.PI, // половина «от упора до упора», рад
    };
  }

  function byId(id) {
    return presets.find((p) => p.id === id) || presets[3];
  }

  return { presets, derive, byId };
})();
