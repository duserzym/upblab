import { describe, expect, it } from 'vitest';
import { CI } from './concordia';
import { normalise } from './review-data';
import { ALIASES, REE, axisLabel, catalogue, normalized, quantityValue, resolveQuantity } from './geochem';
const spot = (values: Record<string, unknown>) => normalise({ acquisition_id: 'a', ...values });
const find = (id: string, values: Record<string, unknown>) => resolveQuantity(id, catalogue([spot(values)]));
const value = (id: string, values: Record<string, unknown>) => quantityValue(find(id, values), spot(values));
describe('geochemistry catalogue', () => {
  it('groups dates, atomic-number ordered elements, isotope and mass ratios, anomalies, thermometers and pending numbers', () => {
    const rows = [spot({ U: 8, Yb: 2, La: 1, Ti: 4, '206Pb/238U_age': 550, preferred_date: 550, 'Th/U': 0.3, '206Pb/238U': 0.1, 'Eu/Eu*': 0.1, 'T_Ti_zircon': 700, 'disc%': 2, pending: 4, U_95CI: 1, '206Pb/238U_age_2e': 3 })];
    const list = catalogue(rows).filter(q => q.available);
    expect(list.filter(q=>q.group==='Concentrations').map(q=>q.id)).toEqual(['Ti', 'La', 'Yb', 'U']);
    expect(list.find(q=>q.id==='La')?.ree).toBe(true);
    expect(list.find(q=>q.id==='preferred_date')?.group).toBe('Dates');
    expect(list.find(q=>q.id==='206Pb/238U')?.group).toBe('Ratios');
    expect(list.find(q=>q.id==='U/Yb')?.group).toBe('Ratios');
    expect(list.find(q=>q.id==='Eu/Eu*')?.group).toBe('REE anomalies');
    expect(list.find(q=>q.id==='Ti-in-zircon T')?.group).toBe('Thermometers');
    expect(list.find(q=>q.id==='stored:pending')?.group).toBe('Other');
    expect(list.some(q=>q.id.includes('95CI')||q.id.includes('_2e'))).toBe(false);
    expect(list.find(q=>q.id==='ΣREE+Y')).toBeUndefined();
  });
  it('matches all central aliases case insensitively, including stored-only thermometers', () => {
    for (const [id, aliases] of Object.entries(ALIASES)) for (const alias of aliases) {
      expect(value(id, {[alias.toUpperCase()]: 123})).toBe(123);
    }
    expect(value('U', { u: 7 })).toBe(7);
    expect(value('Ti-in-zircon T', { Ti: 10, Si: 1 })).toBeNull();
    expect(value('Zr-in-rutile T', { Zr: 500, Ti: 1 })).toBeNull();
    expect(value('preferred_date', { '206Pb/238U': 0.1 })).toBeNull();
  });
  it('computes only the permitted display quotients, normalisations, anomalies and complete REE+Y sum', () => {
    expect(value('U/Yb', {U:12,Yb:3})).toBe(4);
    expect(value('Yb/Gd', {Yb:12,Gd:3})).toBe(4);
    expect(value('Nb/Ta', {Nb:12,Ta:3})).toBe(4);
    const norm = Object.fromEntries(REE.map(e=>[e,CI[e]*2]));
    expect(normalized(spot(norm),'La')).toBe(2);
    expect(value('(Sm/La)N', {...norm,Sm:CI.Sm*8})).toBe(4);
    expect(value('(Yb/Gd)N', {...norm,Yb:CI.Yb*8})).toBe(4);
    expect(value('Eu/Eu*', {...norm,Sm:CI.Sm*4,Gd:CI.Gd*9,Eu:CI.Eu*12})).toBeCloseTo(2,14);
    expect(value('Ce/Ce*', {...norm,La:CI.La*4,Pr:CI.Pr*9,Ce:CI.Ce*12})).toBeCloseTo(2,14);
    expect(value('Eu/Eu*', {Eu_N:12,Sm_N:4,Gd_N:9})).toBe(2);
    expect(value('Ce/Ce*', {Ce_N:12,La_N:4,Pr_N:9})).toBe(2);
    expect(value('ΣREE+Y', {...Object.fromEntries(REE.map(e=>[e,2])),Y:5})).toBe(33);
    expect(value('ΣREE', norm)).toBeNull();
  });
  it('uses stored values, even nulls, ahead of derived values and marks derived labels', () => {
    expect(value('U/Yb', {U:12,Yb:3,'u/yb':99})).toBe(99);
    expect(value('Th/U', {Th:12,U:3,'Th/U':0.25})).toBe(0.25);
    expect(value('Eu/Eu*', {Eu:1,Sm:1,Gd:1,'eu/eu*':3})).toBe(3);
    expect(value('U/Yb', {U:12,Yb:3,'U/Yb':null})).toBeNull();
    expect(normalized(spot({La:CI.La*2,La_N:7}),'La')).toBe(7);
    expect(axisLabel(find('U/Yb',{U:12,Yb:3}))).toBe('U/Yb (from stored ppm)');
    expect(axisLabel(find('U/Yb',{U:12,Yb:3,'U/Yb':4}))).toBe('U/Yb');
  });
  it('rejects missing, zero denominators, negatives and non-finite values; never treats a partial sum as complete', () => {
    for (const Yb of [0,-1,null,NaN,Infinity]) expect(value('U/Yb',{U:12,Yb})).toBeNull();
    expect(value('U/Yb',{U:-1,Yb:2})).toBeNull();
    expect(value('Eu/Eu*',{Eu:1,Sm:0,Gd:1})).toBeNull();
    expect(value('ΣREE+Y',{La:1,Y:2})).toBeNull();
    expect(find('La',{La:null}).available).toBe(false);
  });
});
