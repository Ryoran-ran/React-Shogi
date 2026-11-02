import {expect,test} from "bun:test";
import {applyChessAppearance,canApplyChessAppearance,createChessPreset,CHESS_PIECES} from "../src/presets";
import {BoardEditor} from "../src/editor";
import {PieceEditor,renderPieceEditor} from "../src/pieceeditor";
import {pieceDesign,loadPieceRules,updatePieceDesign,updatePieceMovements} from "../src/pieces";
import {renderPiece} from "../src/pieceview";
import {PIECE_ICONS,renderPieceIcon} from "../src/pieceicons";
import {ShogiGame,initialPosition,positionKey,validatePosition,legalMoves} from "../src/shogi";
import {createSetup,loadSetup} from "../src/setups";
import {algebraicSquare,boardSideName} from "../src/boarddesign";

test("chess appearance can be applied to an edited old layout without replacing its movements, code or piece data",()=>{
  const preset=createChessPreset(),position=structuredClone(preset.position);
  delete position.boardTheme;delete position.squareColors;
  position.board[52]!.data={moved:true,doubleStep:false};
  let rules=updatePieceMovements(preset.pieceRules!,CHESS_PIECES.p,false,"moves",[{dx:0,dy:1,range:1}]);
  for(const type of Object.values(CHESS_PIECES))rules=updatePieceDesign(rules,type,false,"sente",{text:"旧",shape:"circle",fill:"#aabbcc",color:"#112233"});
  const editor=new BoardEditor(position,rules,preset.ruleScript),before=editor.snapshot;
  expect(canApplyChessAppearance(rules)).toBe(true);expect(canApplyChessAppearance({})).toBe(false);
  const appearance=applyChessAppearance(editor.position,editor.pieceRules);editor.reset(appearance.position,appearance.rules,editor.ruleScript);
  expect(editor.position.board).toEqual(before.position.board);expect(editor.ruleScript).toBe(before.script);
  for(const type of Object.values(CHESS_PIECES)){
    const {design:oldDesign,...oldRule}=before.rules[type]!,{design:newDesign,...newRule}=editor.pieceRules[type]!;
    expect(newRule).toEqual(oldRule);expect(newDesign!.normal!.sente!.shape).toBe("chess");
  }
  expect(editor.position.squareColors?.filter(color=>color==="#eeeed2")).toHaveLength(32);
  expect(editor.position.squareColors?.[56]).toBe("#7f9a7a");expect(editor.position.squareColors?.[63]).toBe("#eeeed2");
  expect(editor.position.boardTheme).toBe("chess");expect(positionKey(editor.position)).toBe(positionKey(before.position));
  editor.undo();expect(editor.snapshot).toEqual(before);editor.redo();expect(editor.position.boardTheme).toBe("chess");
});

test("vector pieces have editable independent silhouettes and colors that survive drafts and game files",()=>{
  const setup=createChessPreset(),editor=new PieceEditor(setup.pieceRules,CHESS_PIECES.p);
  editor.handleClick({dataset:{pieceSection:"design"},id:""});
  expect(renderPieceEditor(editor.view)).toContain('data-design-field="icon"');
  editor.handleChange({id:"",dataset:{designSide:"sente",designField:"icon"},value:"knight"});
  editor.handleChange({id:"",dataset:{designSide:"sente",designField:"fill"},value:"#ffaacc"});
  const restored=PieceEditor.restore(editor.draft),rules=restored.pieceRules;
  expect(pieceDesign({type:CHESS_PIECES.p,side:"sente",promoted:false},rules)).toMatchObject({icon:"knight",fill:"#ffaacc"});
  expect(pieceDesign({type:CHESS_PIECES.p,side:"gote",promoted:false},rules)).toMatchObject({icon:"pawn",fill:"#2d4236"});
  editor.handleClick({id:"piece-editor-undo"});expect(pieceDesign({type:CHESS_PIECES.p,side:"sente",promoted:false},editor.pieceRules).fill).toBe("#fff9e8");
  editor.handleClick({id:"piece-editor-redo"});expect(editor.pieceRules).toEqual(rules);
  const markup=renderPiece({type:CHESS_PIECES.p,side:"sente",promoted:false},rules);
  expect(markup).toContain('fill="#ffaacc"');expect(markup).toContain('viewBox="0 0 80 100"');expect(markup).toContain('background:transparent');
  const game=new ShogiGame(setup.position,{pieceRules:rules,ruleScript:setup.ruleScript,passLimit:0});
  expect(game.save().version).toBe(11);expect(ShogiGame.load(JSON.parse(JSON.stringify(game.save()))).pieceRules).toEqual(rules);
  const exported=createSetup(setup.position,0,"チェス",rules,setup.ruleScript);expect(exported.version).toBe(9);expect(loadSetup(JSON.parse(JSON.stringify(exported)))).toEqual(exported);
  expect(()=>loadSetup({...exported,version:8})).toThrow("保存形式");expect(()=>ShogiGame.load({...game.save(),version:10})).toThrow("保存形式");
  expect(new Set(PIECE_ICONS.map(icon=>renderPieceIcon(icon,"#ffffff","#000000"))).size).toBe(6);
  expect(()=>renderPieceIcon('bad' as any,"#ffffff","#000000")).toThrow();
  expect(()=>loadPieceRules({P:{design:{normal:{sente:{text:"駒",shape:"chess",icon:'<svg>',fill:"#ffffff",color:"#000000"}}}}})).toThrow();
});

test("board coordinate and side presentation is persistent, undoable and independent of the game rules",()=>{
  const initial=initialPosition(),editor=new BoardEditor(initial);editor.setBoardTheme("chess");
  expect(positionKey(editor.position)).toBe(positionKey(initial));expect(legalMoves(editor.position)).toEqual(legalMoves(initial));
  expect(boardSideName(editor.position,"sente")).toBe("白");expect(boardSideName(initial,"gote")).toBe("後手");
  expect(algebraicSquare({width:8,height:8},0)).toBe("a8");expect(algebraicSquare({width:8,height:8},63)).toBe("h1");
  const setup=createSetup(editor.position,0);expect(setup.pieceRules).toEqual({});expect(loadSetup(setup).version).toBe(9);
  const game=new ShogiGame(editor.position,{passLimit:0});game.play({from:54,to:45,promote:false});
  expect(ShogiGame.load(game.save()).position.boardTheme).toBe("chess");expect(game.save().pieceRules).toEqual({});
  editor.resize(8,8);editor.clear();expect(editor.position.boardTheme).toBe("chess");editor.setBoardTheme("shogi");expect(editor.position.boardTheme).toBeUndefined();editor.undo();expect(editor.position.boardTheme).toBe("chess");
  expect(()=>validatePosition({...initial,boardTheme:"bad"} as any)).toThrow();
});
