import { afterEach, describe, expect, it, vi } from 'vitest';
import { QUANTITIES } from './geochem';
import { BOARD_KEY, MINERALS, MAX_PANELS, applyPreset, gridColumns, loadBoards, mineralFor, panel, parseBoards, preset, sampleSelection, saveBoards } from './geochem-board';
afterEach(()=>vi.unstubAllGlobals());
describe('geochemistry boards',()=>{
  it('resolves every mineral preset axis and respects the applied board limit',()=>{
    const ids=new Set(QUANTITIES.map(q=>q.id));
    for(const mineral of MINERALS) {
      for(const p of preset(mineral)) {expect(ids.has(p.x)).toBe(true);expect(ids.has(p.y)).toBe(true);}
      expect(applyPreset(mineral).length).toBeLessThanOrEqual(MAX_PANELS);
    }
    expect(applyPreset('Zircon').some(p=>p.type==='ree')).toBe(true);
    expect(preset('Zircon').filter(p=>p.logX&&p.logY)).toHaveLength(3);
    expect(mineralFor('apatite')).toBe('Apatite');expect(mineralFor(undefined)).toBe('Zircon');
  });
  it('chooses columns from container width, including compact and boundary cases',()=>{
    expect([320,459,460,784,879,880,944].map(gridColumns)).toEqual([2,2,2,2,2,3,3]);
  });
  it('persists valid per-mineral boards and deliberate empty boards with fresh unique panel ids',()=>{
    const saved={Zircon:[panel('U','Th',true)],Apatite:[]};
    const getItem=vi.fn(()=>JSON.stringify(saved)),setItem=vi.fn();
    vi.stubGlobal('localStorage',{getItem,setItem});
    const loaded=loadBoards();expect(getItem).toHaveBeenCalledWith(BOARD_KEY);
    expect(loaded.Zircon?.[0]).toMatchObject({type:'biplot',x:'U',y:'Th',logX:true,logY:false});
    expect(loaded.Zircon?.[0].id).not.toBe(saved.Zircon[0].id);expect(loaded.Apatite).toEqual([]);
    saveBoards(loaded);expect(setItem).toHaveBeenCalledWith(BOARD_KEY,JSON.stringify(loaded));
  });
  it('ignores bad JSON, bad panels, unknown axes and overlong boards; works without storage',()=>{
    for(const raw of ['bad','null','[]','{"Zircon":{}}','{"Zircon":[{}]}',JSON.stringify({Zircon:[{...panel('U','Th'),x:'made-up'}]}),JSON.stringify({Zircon:Array.from({length:MAX_PANELS+1},()=>panel('U','Th'))})]) expect(parseBoards(raw)).toEqual({});
    expect(parseBoards(JSON.stringify({Rutile:[panel('stored:custom','U')]})).Rutile).toHaveLength(1);
    vi.stubGlobal('localStorage',{getItem(){throw new Error('disabled');},setItem(){throw new Error('disabled');}});
    expect(loadBoards()).toEqual({});expect(()=>saveBoards({})).not.toThrow();
  });
});
describe('sample chips',()=>{
  const names=['A','B','C'];
  it('click isolates, Cmd/Ctrl toggles from all or a subset, All shows all and Clear hides all',()=>{
    expect(sampleSelection(null,names,'click','B')).toEqual(['B']);
    expect(sampleSelection(['A'],names,'click','B',true)).toEqual(['A','B']);
    expect(sampleSelection(null,names,'click','B',true)).toEqual(['A','C']);
    expect(sampleSelection(['B'],names,'click','B',true)).toEqual([]);
    expect(sampleSelection(['B'],names,'all')).toBeNull();
    expect(sampleSelection(null,names,'clear')).toEqual([]);
    expect(sampleSelection([],names,'click','C',true)).toEqual(['C']);
  });
});
