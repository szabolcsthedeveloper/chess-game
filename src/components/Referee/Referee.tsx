import { Howl } from "howler";
import { useMemo, useRef, useState } from "react";
import { initialBoard } from "../../Constants";
import { Piece, Position } from "../../models";
import { Board } from "../../models/Board";
import { Pawn } from "../../models/Pawn";
import {
  bishopMove,
  kingMove,
  knightMove,
  pawnMove,
  queenMove,
  rookMove
} from "../../referee/rules";
import { PieceType, TeamType } from "../../Types";
import { useWebWorker } from "../../worker/useWebWorker";
import Chessboard from "../Chessboard/Chessboard";
const jsChessEngine = require('js-chess-engine')

const moveSound = new Howl({
  src: ["/sounds/move-self.mp3"],
});

const captureSound = new Howl({
  src: ["/sounds/capture.mp3"],
});

const checkmateSound = new Howl({
  src: ["/sounds/move-check.mp3"],
});

function getPositionLetter(x: number): string {
  return String.fromCharCode(x + 65);
}

function getPieceLetter(piece: Piece): string {
  let letter = "p";
  if(piece.isKing) letter = 'k';
  if(piece.isQueen) letter = 'q';
  if(piece.isRook) letter = 'r';
  if(piece.isBishop) letter = 'b';
  if(piece.isKnight) letter = 'n';

  return piece.team === TeamType.OUR ? letter.toUpperCase(): letter;
}

function parseBoardToChessEngine(board: Board) {
  const pieces = board.pieces.reduce((previousValue, currentPiece) => {
    return {
      ...previousValue,
      [getPositionLetter(currentPiece.position.x) + (currentPiece.position.y+1)]: getPieceLetter(currentPiece)
    }
  }, {})
  const chessEngineBoard = {
    turn: board.totalTurns % 2 === 1 ? 'white' : 'black',
    pieces
  }

  return chessEngineBoard;
}

export default function Referee() {
  const [board, setBoard] = useState<Board>(initialBoard.clone());
  const [promotionPawn, setPromotionPawn] = useState<Piece>();
  const modalRef = useRef<HTMLDivElement>(null);
  const checkmateModalRef = useRef<HTMLDivElement>(null);
  const workerInstance = useMemo(() => new Worker(new URL('../../worker/chess-engine-worker', import.meta.url)), []);

  const {
    running,
    error,
    result,
    startProcessing,
  } = useWebWorker<any, any>(workerInstance);

  console.log(result);

  function playMove(playedPiece: Piece, destination: Position): boolean {
    // If the playing piece doesn't have any moves return
    if (playedPiece.possibleMoves === undefined) return false;

    // Prevent the inactive team from playing
    if (playedPiece.team === TeamType.OUR && board.totalTurns % 2 !== 1)
      return false;
    if (playedPiece.team === TeamType.OPPONENT && board.totalTurns % 2 !== 0)
      return false;

    let playedMoveIsValid = false;

    const validMove = playedPiece.possibleMoves?.some((m) =>
      m.samePosition(destination)
    );

    if (!validMove) return false;

    const enPassantMove = isEnPassantMove(
      playedPiece.position,
      destination,
      playedPiece.type,
      playedPiece.team
    );

    // playMove modifies the board thus we
    // need to call setBoard
    setBoard(() => {
      const clonedBoard = board.clone();
      clonedBoard.totalTurns += 1;
      // Playing the move
      playedMoveIsValid = clonedBoard.playMove(
        enPassantMove,
        validMove,
        playedPiece,
        destination
      );

      if (playedMoveIsValid) {
        moveSound.play();
      }

      if (clonedBoard.winningTeam !== undefined) {
        checkmateModalRef.current?.classList.remove("hidden");
        checkmateSound.play();
      }

      return clonedBoard;
    });

    // This is for promoting a pawn
    let promotionRow = playedPiece.team === TeamType.OUR ? 7 : 0;

    if (destination.y === promotionRow && playedPiece.isPawn) {
      modalRef.current?.classList.remove("hidden");
      setPromotionPawn((previousPromotionPawn) => {
        const clonedPlayedPiece = playedPiece.clone();
        clonedPlayedPiece.position = destination.clone();
        return clonedPlayedPiece;
      });
    }

    return playedMoveIsValid;
  }

  function isEnPassantMove(
    initialPosition: Position,
    desiredPosition: Position,
    type: PieceType,
    team: TeamType
  ) {
    const pawnDirection = team === TeamType.OUR ? 1 : -1;

    if (type === PieceType.PAWN) {
      if (
        (desiredPosition.x - initialPosition.x === -1 ||
          desiredPosition.x - initialPosition.x === 1) &&
        desiredPosition.y - initialPosition.y === pawnDirection
      ) {
        const piece = board.pieces.find(
          (p) =>
            p.position.x === desiredPosition.x &&
            p.position.y === desiredPosition.y - pawnDirection &&
            p.isPawn &&
            (p as Pawn).enPassant
        );
        if (piece) {
          return true;
        }
      }
    }

    return false;
  }

  //TODO
  //Add stalemate!
  function isValidMove(
    initialPosition: Position,
    desiredPosition: Position,
    type: PieceType,
    team: TeamType
  ) {
    let validMove = false;
    switch (type) {
      case PieceType.PAWN:
        validMove = pawnMove(
          initialPosition,
          desiredPosition,
          team,
          board.pieces
        );
        break;
      case PieceType.KNIGHT:
        validMove = knightMove(
          initialPosition,
          desiredPosition,
          team,
          board.pieces
        );
        break;
      case PieceType.BISHOP:
        validMove = bishopMove(
          initialPosition,
          desiredPosition,
          team,
          board.pieces
        );
        break;
      case PieceType.ROOK:
        validMove = rookMove(
          initialPosition,
          desiredPosition,
          team,
          board.pieces
        );
        break;
      case PieceType.QUEEN:
        validMove = queenMove(
          initialPosition,
          desiredPosition,
          team,
          board.pieces
        );
        break;
      case PieceType.KING:
        validMove = kingMove(
          initialPosition,
          desiredPosition,
          team,
          board.pieces
        );
    }

    return validMove;
  }

  function promotePawn(pieceType: PieceType) {
    if (promotionPawn === undefined) {
      return;
    }

    setBoard((previousBoard) => {
      const clonedBoard = board.clone();
      clonedBoard.pieces = clonedBoard.pieces.reduce((results, piece) => {
        if (piece.samePiecePosition(promotionPawn)) {
          results.push(
            new Piece(piece.position.clone(), pieceType, piece.team, true)
          );
        } else {
          results.push(piece);
        }
        return results;
      }, [] as Piece[]);

      clonedBoard.calculateAllMoves();

      return clonedBoard;
    });

    modalRef.current?.classList.add("hidden");
  }

  function promotionTeamType() {
    return promotionPawn?.team === TeamType.OUR ? "w" : "b";
  }

  function restartGame() {
    checkmateModalRef.current?.classList.add("hidden");
    setBoard(initialBoard.clone());
  }

  function processMainThread(board: any) {
    const { moves, aiMove } = jsChessEngine;
    const newMoves = moves(board);
    const result = aiMove({...board, moves: newMoves}, 2)
    console.log("Best move:", result)
  }

  function calculateBestMoveMainThread() {
    const chessEngineBoard = parseBoardToChessEngine(board);
    processMainThread(chessEngineBoard)
  }

  function calculateBestMoveWebWorker() {
    const chessEngineBoard = parseBoardToChessEngine(board);
    startProcessing(chessEngineBoard)
  }

  return (
    <>
      <button onClick={calculateBestMoveMainThread}>Best move (Main thread)</button>
      <button onClick={calculateBestMoveWebWorker}>Best move (Web worker)</button>
      <p style={{ color: "white", fontSize: "24px", textAlign: "center" }}>
        Total turns: {board.totalTurns}
      </p>
      <div className="modal hidden" ref={modalRef}>
        <div className="modal-body">
          <img
            onClick={() => promotePawn(PieceType.ROOK)}
            src={`/assets/images/rook_${promotionTeamType()}.png`}
          />
          <img
            onClick={() => promotePawn(PieceType.BISHOP)}
            src={`/assets/images/bishop_${promotionTeamType()}.png`}
          />
          <img
            onClick={() => promotePawn(PieceType.KNIGHT)}
            src={`/assets/images/knight_${promotionTeamType()}.png`}
          />
          <img
            onClick={() => promotePawn(PieceType.QUEEN)}
            src={`/assets/images/queen_${promotionTeamType()}.png`}
          />
        </div>
      </div>
      <div className="modal hidden" ref={checkmateModalRef}>
        <div className="modal-body">
          <div className="checkmate-body">
            <span>
              The winning team is{" "}
              {board.winningTeam === TeamType.OUR ? "white" : "black"}!
            </span>
            <button onClick={restartGame}>Play again</button>
          </div>
        </div>
      </div>
      <Chessboard playMove={playMove} pieces={board.pieces} />
    </>
  );
}
