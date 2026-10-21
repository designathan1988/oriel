import { beforeAll, describe, expect, it } from 'vitest';
import { loadKernel } from '../../src/f3/kernel/kernel';
import { exportIFC, ifcGuid } from '../../src/f3/io/ifc';
import { building, facadeRule, levelsFor, project, rectPlan, roofSpec, solid } from '../../src/f3/model/defaults';

beforeAll(async () => {
  await loadKernel();
});

describe('IFC4 export', () => {
  it('GlobalIds are 22 IFC base-64 characters, stable per seed', () => {
    const g = ifcGuid('x');
    expect(g).toMatch(/^[0-3][0-9A-Za-z_$]{21}$/);
    expect(ifcGuid('x')).toBe(g);
    expect(ifcGuid('y')).not.toBe(g);
  });

  it('web-ifc reads the file back: project, storeys, walls, slabs, roof and windows with geometry', async () => {
    const s = solid({ plan: { outer: rectPlan(12, 8), holes: [] }, height: 6, roof: roofSpec('hip') });
    s.facade = [facadeRule('win-casement', { levels: 'all', mode: 'count', value: 2 })];
    const b = building({ name: 'Casa', position: [5, 3], solids: [s], levels: levelsFor(2, 3, 3) });
    const text = exportIFC(project({ name: 'Teste ção', buildings: [b] }));
    expect(text.startsWith('ISO-10303-21;')).toBe(true);
    const WebIFC = await import('web-ifc');
    const api = new WebIFC.IfcAPI();
    await api.Init();
    const id = api.OpenModel(new TextEncoder().encode(text));
    const count = (t: number) => api.GetLineIDsWithType(id, t).size();
    expect(count(WebIFC.IFCPROJECT)).toBe(1);
    expect(count(WebIFC.IFCBUILDING)).toBe(1);
    expect(count(WebIFC.IFCBUILDINGSTOREY)).toBe(2);
    expect(count(WebIFC.IFCWALL)).toBeGreaterThanOrEqual(1);
    expect(count(WebIFC.IFCROOF)).toBeGreaterThanOrEqual(1);
    expect(count(WebIFC.IFCWINDOW)).toBeGreaterThanOrEqual(8);
    // The geometry of every product comes out as triangles.
    let tris = 0;
    api.StreamAllMeshes(id, (mesh) => {
      for (let i = 0; i < mesh.geometries.size(); i++) {
        const g = api.GetGeometry(id, mesh.geometries.get(i).geometryExpressID);
        tris += g.GetIndexDataSize() / 3;
        g.delete();
      }
    });
    expect(tris).toBeGreaterThan(500);
    api.CloseModel(id);
  }, 60000);

  it('the furnished house: its five rooms as IfcSpace with name, net floor area and a body; furniture and interior walls', async () => {
    const { TEMPLATES } = await import('../../src/f3/io/templates');
    const text = exportIFC(TEMPLATES.find((t) => t.id === 'house')!.make());
    const WebIFC = await import('web-ifc');
    const api = new WebIFC.IfcAPI();
    await api.Init();
    const id = api.OpenModel(new TextEncoder().encode(text));
    const ids = api.GetLineIDsWithType(id, WebIFC.IFCSPACE);
    expect(ids.size()).toBe(5);
    const names: string[] = [];
    for (let i = 0; i < ids.size(); i++) names.push(api.GetLine(id, ids.get(i)).LongName.value);
    expect(names.sort()).toEqual(['Banheiro', 'Circulação', 'Quarto 1', 'Quarto 2', 'Sala e cozinha']);
    const areas = api.GetLineIDsWithType(id, WebIFC.IFCQUANTITYAREA);
    let total = 0;
    for (let i = 0; i < areas.size(); i++) total += api.GetLine(id, areas.get(i)).AreaValue.value;
    expect(total).toBeGreaterThan(95);
    expect(total).toBeLessThan(102);
    expect(api.GetLineIDsWithType(id, WebIFC.IFCFURNITURE).size()).toBeGreaterThanOrEqual(10);
    // Every space has a body (an extrusion web-ifc turns into triangles).
    // (web-ifc leaves spaces out of StreamAllMeshes, so each is asked for by its id.)
    let withMesh = 0;
    for (let i = 0; i < ids.size(); i++) if (api.GetFlatMesh(id, ids.get(i)).geometries.size() > 0) withMesh++;
    expect(withMesh).toBe(5);
    expect(text).toContain("'Interior walls'");
    api.CloseModel(id);
  }, 60000);
});
