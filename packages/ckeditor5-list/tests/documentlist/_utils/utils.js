/**
 * @license Copyright (c) 2003-2022, CKSource Holding sp. z o.o. All rights reserved.
 * For licensing, see LICENSE.md or https://ckeditor.com/legal/ckeditor-oss-license
 */

import Model from '@ckeditor/ckeditor5-engine/src/model/model';
import { getData as getModelData, parse as parseModel, stringify as stringifyModel } from '@ckeditor/ckeditor5-engine/src/dev-utils/model';
import { getData as getViewData } from '@ckeditor/ckeditor5-engine/src/dev-utils/view';
import ListWalker from '../../../src/documentlist/utils/listwalker';

/**
 * Sets the editor model according to the specified input string.
 *
 * @param {module:engine/model/model~Model} model
 * @param {String} input
 * @returns {module:engine/model/selection~Selection} The selection marked in input string.
 */
export function prepareTest( model, input ) {
	const modelRoot = model.document.getRoot( 'main' );

	// Parse data string to model.
	const parsedResult = parseModel( input, model.schema, { context: [ modelRoot.name ] } );

	// Retrieve DocumentFragment and Selection from parsed model.
	const modelDocumentFragment = parsedResult.model;
	const selection = parsedResult.selection;

	// Ensure no undo step is generated.
	model.enqueueChange( { isUndoable: false }, writer => {
		// Replace existing model in document by new one.
		writer.remove( writer.createRangeIn( modelRoot ) );
		writer.insert( modelDocumentFragment, modelRoot );

		// Clean up previous document selection.
		writer.setSelection( null );
		writer.removeSelectionAttribute( model.document.selection.getAttributeKeys() );
	} );

	const ranges = [];

	for ( const range of selection.getRanges() ) {
		const start = model.createPositionFromPath( modelRoot, range.start.path );
		const end = model.createPositionFromPath( modelRoot, range.end.path );

		ranges.push( model.createRange( start, end ) );
	}

	return model.createSelection( ranges );
}

/**
 * Returns set of test tools for the specified editor instance.
 *
 * @param {module:core/editor/editor~Editor} editor
 * @returns {Object}
 */
export function setupTestHelpers( editor ) {
	const model = editor.model;
	const modelRoot = model.document.getRoot();
	const view = editor.editing.view;

	const test = {
		test( input, output, actionCallback, testUndo ) {
			const callbackSelection = prepareTest( model, input );

			const modelBefore = getModelData( model );
			const viewBefore = getViewData( view, { withoutSelection: true } );

			test.reconvertSpy = sinon.spy( editor.editing, 'reconvertItem' );
			actionCallback( callbackSelection );
			test.reconvertSpy.restore();

			expect( getViewData( view, { withoutSelection: true } ) ).to.equalMarkup( output );

			if ( testUndo ) {
				const modelAfter = getModelData( model );
				const viewAfter = getViewData( view, { withoutSelection: true } );

				editor.execute( 'undo' );

				expect( getModelData( model ), 'after undo' ).to.equalMarkup( modelBefore );
				expect( getViewData( view, { withoutSelection: true } ), 'after undo' ).to.equalMarkup( viewBefore );

				editor.execute( 'redo' );

				expect( getModelData( model ), 'after redo' ).to.equalMarkup( modelAfter );
				expect( getViewData( view, { withoutSelection: true } ), 'after redo' ).to.equalMarkup( viewAfter );
			}
		},

		insert( input, output, testUndo = true ) {
			// Cut out inserted element that is between '[' and ']' characters.
			const selStart = input.indexOf( '[' ) + 1;
			const selEnd = input.indexOf( ']' );

			const item = input.substring( selStart, selEnd );
			const modelInput = input.substring( 0, selStart ) + input.substring( selEnd );

			const actionCallback = selection => {
				model.change( writer => {
					writer.insert( parseModel( item, model.schema ), selection.getFirstPosition() );
				} );
			};

			test.test( modelInput, output, actionCallback, testUndo );
		},

		remove( input, output ) {
			const actionCallback = selection => {
				model.change( writer => {
					writer.remove( selection.getFirstRange() );
				} );
			};

			test.test( input, output, actionCallback );
		},

		changeType( input, output ) {
			const actionCallback = selection => {
				const element = selection.getFirstPosition().nodeAfter;
				const newType = element.getAttribute( 'listType' ) == 'numbered' ? 'bulleted' : 'numbered';

				model.change( writer => {
					const itemsToChange = Array.from( selection.getSelectedBlocks() );

					for ( const item of itemsToChange ) {
						writer.setAttribute( 'listType', newType, item );
					}
				} );
			};

			test.test( input, output, actionCallback );
		},

		renameElement( input, output, testUndo = true ) {
			const actionCallback = selection => {
				const element = selection.getFirstPosition().nodeAfter;

				model.change( writer => {
					writer.rename( element, element.name == 'paragraph' ? 'heading1' : 'paragraph' );
				} );
			};

			test.test( input, output, actionCallback, testUndo );
		},

		removeListAttributes( input, output, testUndo = true ) {
			const actionCallback = selection => {
				const element = selection.getFirstPosition().nodeAfter;

				model.change( writer => {
					writer.removeAttribute( 'listItemId', element );
					writer.removeAttribute( 'listType', element );
					writer.removeAttribute( 'listIndent', element );
				} );
			};

			test.test( input, output, actionCallback, testUndo );
		},

		setListAttributes( newIndent, input, output ) {
			const actionCallback = selection => {
				const element = selection.getFirstPosition().nodeAfter;

				model.change( writer => {
					writer.setAttributes( { listType: 'bulleted', listIndent: newIndent, listItemId: 'x' }, element );
				} );
			};

			test.test( input, output, actionCallback );
		},

		changeIndent( newIndent, input, output ) {
			const actionCallback = selection => {
				model.change( writer => {
					writer.setAttribute( 'listIndent', newIndent, selection.getFirstRange() );
				} );
			};

			test.test( input, output, actionCallback );
		},

		move( input, rootOffset, output, testUndo = true ) {
			const actionCallback = selection => {
				model.change( writer => {
					const targetPosition = writer.createPositionAt( modelRoot, rootOffset );

					writer.move( selection.getFirstRange(), targetPosition );
				} );
			};

			test.test( input, output, actionCallback, testUndo );
		},

		data( input, modelData, output = input ) {
			editor.setData( input );

			expect( editor.getData(), 'output data' ).to.equalMarkup( output );
			expect( getModelData( model, { withoutSelection: true } ), 'model data' ).to.equalMarkup( modelData );
		}
	};

	return test;
}

/**
 * Returns a model representation of a document list pseudo markdown notation:
 *
 * 		modelList( [
 * 			'* foo',
 * 			'* bar'
 * 		] );
 *
 * 	will output:
 *
 * 		'<paragraph listIndent="0" listItemId="000" listType="bulleted">foo</paragraph>' +
 * 		'<paragraph listIndent="0" listItemId="001" listType="bulleted">bar</paragraph>'
 *
 * @param {Iterable.<String>} lines
 * @returns {String}
 */
export function modelList( lines ) {
	const items = [];
	const stack = [];

	if ( !Array.isArray( lines ) ) {
		lines = lines
			// Remove the first and last empty lines.
			.replace( /^[^\n]*\n|\n[^\n]*$/g, '' )
			// Replace tab characters with spaces.
			.replace( /^[\t ]+/gm, match => match.split( '' ).reduce( ( pad, char ) => (
				pad + ( char != '\t' ? char : ' '.repeat( 4 - pad.length % 4 ) )
			), '' ) );

		// Find the indent of the first line.
		const basePad = lines.match( /^\s*/ )[ 0 ].length;

		// Convert to array.
		lines = lines.split( '\n' ).map( line => line.substring( basePad ) );
	}

	let prevIndent = -1;

	for ( const [ idx, line ] of lines.entries() ) {
		let [ , pad, marker, content ] = line.match( /^((?: {2})*(?:([*#]) )?)(.*)/ );
		const listIndent = pad.length / 2 - 1;

		if ( listIndent < 0 ) {
			stack.length = 0;
		} else if ( prevIndent > listIndent ) {
			stack.length = listIndent + 1;
		}

		if ( listIndent < 0 ) {
			items.push( stringifyElement( content ) );
		} else {
			if ( !stack[ listIndent ] && !marker ) {
				throw new Error( 'Invalid indent: ' + line );
			}

			if ( !stack[ listIndent ] || marker ) {
				const props = {
					listType: marker == '#' ? 'numbered' : 'bulleted',
					listItemId: String( idx ).padStart( 3, '0' )
				};

				content = content.replace( /\s*{(?:id:)([^}]+)}\s*/g, ( match, id ) => {
					props.listItemId = id;

					return '';
				} );

				if ( !stack[ listIndent ] || stack[ listIndent ].listType != props.listType ) {
					content = content.replace( /\s*{(?:(style|start|reversed):)([^}]+)}\s*/g, ( match, key, value ) => {
						switch ( key ) {
							case 'style':
								props.listStyle = value;
								break;
							case 'start':
								props.listStart = parseInt( value );
								break;
							case 'reversed':
								props.listReversed = value === true || parseInt( value ) !== 0;
								break;
						}

						return '';
					} );
				}

				stack[ listIndent ] = Object.assign( stack[ listIndent ] || {}, props );
			}

			items.push( stringifyElement( content, { listIndent, ...stack[ listIndent ] } ) );
		}

		prevIndent = listIndent;
	}

	return items.join( '' );
}

/**
 * Returns document list pseudo markdown notation for a given document fragment.
 *
 * @param {module:engine/model/documentfragment~DocumentFragment} fragment The document fragment to stringify to pseudo markdown notation.
 * @returns {String}
 */
export function stringifyList( fragment ) {
	const model = new Model();
	const lines = [];

	model.change( writer => {
		for ( let node = fragment.getChild( 0 ); node; node = node.nextSibling ) {
			let pad = '';

			if ( node.hasAttribute( 'listItemId' ) ) {
				const marker = node.getAttribute( 'listType' ) == 'numbered' ? '#' : '*';
				const indentSpaces = ( node.getAttribute( 'listIndent' ) + 1 ) * 2;
				const isFollowing = !!ListWalker.first( node, { sameIndent: true, sameItemId: true } );

				pad = isFollowing ? ' '.repeat( indentSpaces ) : marker.padStart( indentSpaces - 1 ) + ' ';
			}

			lines.push( `${ pad }${ stringifyNode( node, writer ) }` );
		}
	} );

	return lines.join( '\n' );
}

function stringifyNode( node, writer ) {
	const fragment = writer.createDocumentFragment();

	if ( node.is( 'element', 'paragraph' ) ) {
		for ( const child of node.getChildren() ) {
			writer.append( writer.cloneElement( child ), fragment );
		}
	} else {
		const contentNode = writer.cloneElement( node );

		for ( const key of contentNode.getAttributeKeys() ) {
			if ( key.startsWith( 'list' ) ) {
				writer.removeAttribute( key, contentNode );
			}
		}

		writer.append( contentNode, fragment );
	}

	return stringifyModel( fragment );
}

function stringifyElement( content, attributes = {}, name = 'paragraph' ) {
	[ , name, content ] = content.match( /^<([^>]+)>([^<]*)?/ ) || [ null, name, content ];

	attributes = Object.entries( attributes )
		.sort( ( [ keyA ], [ keyB ] ) => keyA.localeCompare( keyB ) )
		.map( ( [ key, value ] ) => ` ${ key }="${ value }"` )
		.join( '' );

	return `<${ name }${ attributes }>${ content }</${ name.replace( /\s.*/, '' ) }>`;
}