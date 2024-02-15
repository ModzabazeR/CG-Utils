// This plugin will open a window to prompt the user to enter a number, and
// it will then create that many rectangles on the screen.

// This file holds the main code for plugins. Code in this file has access to
// the *figma document* via the figma global object.
// You can access browser APIs in the <script> tag inside "ui.html" which has a
// full browser environment (See https://www.figma.com/plugin-docs/how-plugins-run).

// This shows the HTML page in "ui.html".
figma.showUI(__html__, {width: 400, height: 400});

const pathToCoordinates = (origin: { x: number, y: number }, path: string) => {
    const commandNameMapping: {
        [key: string]: string
    } = {
        M: 'move',
        L: 'line',
        H: 'horizontal',
        V: 'vertical',
        C: 'curve',
        S: 'smooth curve',
        Q: 'quadratic curve',
        T: 'smooth quadratic curve',
        A: 'arc',
        Z: 'close'
    };

    // vector path tokenization
    // cut the string before the encounter of M, L, H, V, C, S, Q, T, A, Z
    // and then split the string into array of strings
    const vectorPathTokens = path.split(/(?=[MLHVCSQTAZ])/).map(token => token.trim());

    let result: {x: number, y: number, type: string}[] = [];

    vectorPathTokens.forEach((token, index) => {
        const [command, ...args] = token.split(' ');
        const argsNum = args.map(Number);
        
        if (command === 'M') {
            const [x, y] = argsNum;
            result.push({
                x: x + origin.x,
                y: y + origin.y,
                // set the type to the next command
                type: commandNameMapping[vectorPathTokens[index + 1][0]]
            })
        } else if (command === 'C') {
            const coordCount = argsNum.length / 2;
            let [lastX, lastY] = argsNum.slice(-2);
            for (let i = 0; i < coordCount; i++) {
                const x = argsNum[i * 2];
                const y = argsNum[i * 2 + 1];
                result.push({
                    x: x + origin.x,
                    y: y + origin.y,
                    type: commandNameMapping[command]
                });
            }
            // check if current token isn't the last token (if the next command is not Z and M)
            // if it is, set the type to the same as next command
            if ((index !== vectorPathTokens.length - 1) && (vectorPathTokens[index + 1][0] !== 'M')) {
                result.push({
                    x: lastX + origin.x,
                    y: lastY + origin.y,
                    type: commandNameMapping[vectorPathTokens[index + 1][0]]
                });
            }
        } else if (command === 'L') {
            const [x, y] = argsNum;
            result.push({
                x: x + origin.x,
                y: y + origin.y,
                type: commandNameMapping[command]
            });
            // check if current token isn't the last token (if the next command is not Z and M)
            // if it is, set the type to the same as next command
            if ((index !== vectorPathTokens.length - 1) && (vectorPathTokens[index + 1][0] !== 'M')) {
                result.push({
                    x: x + origin.x,
                    y: y + origin.y,
                    type: commandNameMapping[vectorPathTokens[index + 1][0]]
                });
            }
        } else if (command === 'Z') {
            result.pop();
        }
    });

    result = result.map(coord => {
        return {
            x: Math.round(coord.x),
            y: Math.round(coord.y),
            type: coord.type
        }
    });

    return result;
};

const generateCode = (coordArray: {x: number, y: number, type: string}[]) => {
  // subdivide the array into chunks of 4 in case of curve
  // subdivide the array into chunks of 2 in case of line

  const finalCode: string[] = [];

  for (let i = 0; i < coordArray.length; i++) {
    const coord = coordArray[i];
    const nextCoord = coordArray[i + 1];
    const nextNextCoord = coordArray[i + 2];
    const nextNextNextCoord = coordArray[i + 3];

    if (coord.type === 'line') {
      finalCode.push(`g2d.drawLine(${coord.x}, ${coord.y}, ${nextCoord.x}, ${nextCoord.y});`);
      // skip the next coord
      i++;
    } else if (coord.type === 'curve') {
      finalCode.push(`drawArc(g2d, new Point(${coord.x}, ${coord.y}), new Point(${nextCoord.x}, ${nextCoord.y}), new Point(${nextNextCoord.x}, ${nextNextCoord.y}), new Point(${nextNextNextCoord.x}, ${nextNextNextCoord.y}), 1, Color.WHITE);`);
      // skip the next 3 coords
      i += 3;
    }
  }

  return finalCode;
};

// Calls to "parent.postMessage" from within the HTML page will trigger this
// callback. The callback will be passed the "pluginMessage" property of the
// posted message.
figma.ui.onmessage = msg => {
  // One way of distinguishing between different types of messages sent from
  // your HTML page is to use an object with a "type" property like this.
  if (msg.type === 'create-rectangles') {
    const nodes: SceneNode[] = [];
    for (let i = 0; i < msg.count; i++) {
      const rect = figma.createRectangle();
      rect.x = i * 150;
      rect.fills = [{type: 'SOLID', color: {r: 1, g: 0.5, b: 0}}];
      figma.currentPage.appendChild(rect);
      nodes.push(rect);
    }
    figma.currentPage.selection = nodes;
    figma.viewport.scrollAndZoomIntoView(nodes);
  }

  if (msg.type === 'show-toast') {
    figma.notify(msg.message, {
      timeout: 5000,
    });
  }

  if (msg.type === 'generate-code') {
    const selectedNode = figma.currentPage.selection[0];
    const finalCode: string[] = [];
    if (selectedNode.type === 'GROUP') {
      const children = selectedNode.children.filter(child => child.type === 'VECTOR') as VectorNode[];
      const paths = children.map(child => {
        return pathToCoordinates({x: child.x, y: child.y}, child.vectorPaths[0].data);
      });
      paths.forEach(path => {
        finalCode.push(...generateCode(path));
      });
    } else if (selectedNode.type === 'VECTOR') {
      const origin = {
        x: selectedNode.x,
        y: selectedNode.y
      };
      const vectorPath = selectedNode.vectorPaths[0].data;
      const vectorPathTokens = pathToCoordinates(origin, vectorPath);
      finalCode.push(...generateCode(vectorPathTokens));
    } else {
      figma.closePlugin('Please select a vector or a group of vectors');
    }

    // display the code in the UI
    figma.ui.postMessage({
      type: 'code-generated',
      code: finalCode.join('\n')
    });
  }

  // Make sure to close the plugin when you're done. Otherwise the plugin will
  // keep running, which shows the cancel button at the bottom of the screen.
  if (msg.type === 'cancel') {
    figma.closePlugin();
  }
};
