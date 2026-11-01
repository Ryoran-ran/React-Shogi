export type SquareColors = Array<string | null>;

export function squareColor(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error("マスの色は6桁のカラーコードで指定してください");
  return value.toLowerCase();
}
export function validateSquareColors(value: unknown, size: number): asserts value is SquareColors | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length !== size || Array.from(value).some(color => color !== null && (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)))) throw new Error("盤面の色の設定が壊れています");
}
export function squareColorStyle(position: { squareColors?: SquareColors }, index: number): string {
  const value = position.squareColors?.[index];
  if (!value) return "";
  const color = squareColor(value)!;
  const [r,g,b] = [1,3,5].map(offset => parseInt(color.slice(offset,offset+2),16));
  const mark = r*.299+g*.587+b*.114 < 140 ? "#fff6dc" : "#405b45";
  return ` style="--square-color:${color};--square-mark:${mark}"`;
}

export type BoardTheme = "chess";
export function boardSideMark(position:{boardTheme?:BoardTheme;settings?:{playerRules?:Partial<Record<"sente"|"gote",{mark?:string}>>}},side:"sente"|"gote"):string{return position.settings?.playerRules?.[side]?.mark??(position.boardTheme==="chess"?(side==="sente"?"○":"●"):(side==="sente"?"▲":"△"));}
export function algebraicSquare(position: {width:number;height:number}, index:number):string{return String.fromCharCode(97+index%position.width)+(position.height-Math.floor(index/position.width));}
export function boardSideName(position:{boardTheme?:BoardTheme;settings?:{playerRules?:Partial<Record<"sente"|"gote",{name?:string}>>}},side:"sente"|"gote"):string{return position.settings?.playerRules?.[side]?.name??(position.boardTheme==="chess"?(side==="sente"?"白":"黒"):(side==="sente"?"先手":"後手"));}
