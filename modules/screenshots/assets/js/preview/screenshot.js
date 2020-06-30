/* global ElementorScreenshotConfig, jQuery */
class Screenshot {
	constructor() {
		/**
		 * Holds the screen shot Iframe.
		 */
		this.$elementor = null;

		/**
		 * The config that provided from the backend.
		 *
		 * @var object
		 */
		this.config = {
			crop: {
				width: 1200,
				height: 1500,
			},
			excludeCssUrls: [
				'https://kit-pro.fontawesome.com',
			],
			timeout: 5000, // 5 secs
			timerLabel: 'timer',
		};

		jQuery( () => this.init() );
	}

	/**
	 * The main method for this class.
	 */
	init() {
		this.log( 'Screeenshot init', 'time' );

		this.$elementor = jQuery( ElementorScreenshotConfig.selector );
		this.config = {
			...this.config,
			...ElementorScreenshotConfig,
		};

		if ( ! this.$elementor.length ) {
			elementorCommon.helpers.consoleWarn( 'Screenshots: Elementor content was not found.' );

			return;
		}

		this.handleIFrames();
		this.handleSlides();
		this.hideUnnecessaryElements();
		this.loadExternalCss();

		Promise.resolve()
			.then( this.createImage.bind( this ) )
			.then( this.createImageElement.bind( this ) )
			.then( this.cropCanvas.bind( this ) )
			.then( this.save.bind( this ) )
			.then( () => {
				window.top.postMessage( { name: 'capture-screenshot-done' }, '*' );

				this.log( 'Screenshot End.', 'timeEnd' );
			} );
	}

	/**
	 * Html to images libraries can not snapshot IFrames
	 * this method convert all the IFrames to some other elements.
	 */
	handleIFrames() {
		this.$elementor.find( 'iframe' ).each( ( index, el ) => {
			const $iframe = jQuery( el );

			const $iframeMask = jQuery( '<div />', {
				css: {
					background: 'gray',
					width: $iframe.width(),
					height: $iframe.height(),
				},
			} );

			if ( $iframe.next().is( '.elementor-custom-embed-image-overlay' ) ) {
				this.handleCustomEmbedImageIFrame( $iframe, $iframeMask );
			} else if ( -1 !== $iframe.attr( 'src' ).search( 'youtu' ) ) {
				this.handleYouTubeIFrame( $iframe, $iframeMask );
			}

			$iframe.before( $iframeMask );
			$iframe.remove();
		} );
	}

	/**
	 * @param $iframe
	 * @param $iframeMask
	 */
	handleCustomEmbedImageIFrame( $iframe, $iframeMask ) {
		const regex = /url\(\"(.*)\"/gm;
		const url = $iframe.next().css( 'backgroundImage' );
		const matches = regex.exec( url );

		$iframeMask.css( { background: $iframe.next().css( 'background' ) } );

		$iframeMask.append( jQuery( '<img />', {
			src: matches[ 1 ],
			css: {
				width: $iframe.width(),
				height: $iframe.height(),
			},
		} ) );

		$iframe.next().remove();
	}

	/**
	 * @param $iframe
	 * @param $iframeMask
	 */
	handleYouTubeIFrame( $iframe, $iframeMask ) {
		const regex = /^.*(?:youtu.be\/|youtube(?:-nocookie)?.com\/(?:(?:watch)??(?:.*&)?vi?=|(?:embed|v|vi|user)\/))([^?&"'>]+)/;
		const matches = regex.exec( $iframe.attr( 'src' ) );

		$iframeMask.append( jQuery( '<img />', {
			src: this.getScreenshotProxyUrl( `https://img.youtube.com/vi/${ matches[ 1 ] }/0.jpg` ),
			crossOrigin: 'Anonymous',
			css: {
				width: $iframe.width(),
				height: $iframe.height(),
			},
		} ) );
	}

	/**
	 * Slides should show only the first slide, all the other slides will be removed.
	 */
	handleSlides() {
		this.$elementor.find( '.elementor-slides' ).each( ( index, el ) => {
			const $this = jQuery( el );

			$this.find( '> *' ).not( $this.find( '> :first-child' ) ).each( ( childIndex, childEl ) => {
				jQuery( childEl ).remove();
			} );
		} );
	}

	/**
	 * CSS from another server cannot be loaded with the current dom to image library.
	 * this method take all the links from another domain and proxy them.
	 */
	loadExternalCss() {
		const excludeUrls = [
			this.config.home_url,
			...this.config.excludeCssUrls,
		];

		const notSelector = excludeUrls.map( ( url ) => {
			return `[href^="${ url }"]`;
		} ).join( ', ' );

		jQuery( 'link' ).not( notSelector ).each( ( index, el ) => {
			const $link = jQuery( el );
			const $newLink = $link.clone();

			$newLink.attr( 'href', this.getScreenshotProxyUrl( $link.attr( 'href' ) ) );

			jQuery( 'head' ).append( $newLink );
			$link.remove();
		} );
	}

	/**
	 * Hide all the element except for the target element.
	 */
	hideUnnecessaryElements() {
		jQuery( 'body' ).prepend(
			this.$elementor
		);

		jQuery( 'body > *' ).not( this.$elementor ).css( 'display', 'none' );
	}

	/**
	 * Creates a png image.
	 *
	 * @returns {Promise<unknown>}
	 */
	createImage() {
		const pageLoadedPromise = new Promise( ( resolve ) => {
			window.addEventListener( 'load', () => {
				resolve();
			} );
		} );

		const timeOutPromise = new Promise( ( resolve ) => {
			setTimeout( () => {
				resolve();
			}, this.config.timeout );
		} );

		return Promise.race( [ pageLoadedPromise, timeOutPromise ] )
			.then( () => {
				this.log( 'Start creating screenshot.' );

				return domtoimage.toPng( document.body, {} );
			} );
	}

	/**
	 * Creates fake image element to get the size of the image later on.
	 *
	 * @param dataUrl
	 * @returns {Promise<HTMLImageElement>}
	 */
	createImageElement( dataUrl ) {
		const image = new Image();
		image.src = dataUrl;

		return new Promise( ( resolve ) => {
			image.onload = () => {
				resolve( image );
			};
		} );
	}

	/**
	 * Crop the image to requested sizes.
	 *
	 * @param image
	 * @returns {Promise<unknown>}
	 */
	cropCanvas( image ) {
		const cropCanvas = document.createElement( 'canvas' );
		const cropContext = cropCanvas.getContext( '2d' );
		const ratio = this.config.crop.width / image.width;

		cropCanvas.width = this.config.crop.width;
		cropCanvas.height = this.config.crop.height;

		cropContext.drawImage( image, 0, 0, image.width, image.height, 0, 0, image.width * ratio, image.height * ratio );

		return Promise.resolve( cropCanvas );
	}

	/**
	 * Send the image to the server.
	 *
	 * @param canvas
	 * @returns {*}
	 */
	save( canvas ) {
		return elementorCommon.ajax.addRequest( 'screenshot_save', {
			data: {
				post_id: this.config.post_id,
				screenshot: canvas.toDataURL( 'image/png' ),
			},
			success: ( url ) => {
				this.log( `Screenshot created: ${ encodeURI( url ) }` );
			},
			error: () => {
				this.log( 'Failed to create screenshot.' );
			},
		} );
	}

	/**
	 * @param url
	 * @returns {string}
	 */
	getScreenshotProxyUrl( url ) {
		return `${ this.config.home_url }?screenshot_proxy&nonce=${ this.config.nonce }&href=${ url }`;
	}

	/**
	 * Log messages for debugging.
	 *
	 * @param message
	 * @param timerMethod
	 */
	log( message, timerMethod = 'timeLog' ) {
		if ( ! elementorCommonConfig.isDebug ) {
			return;
		}

		// eslint-disable-next-line no-console
		console.log( message );

		// eslint-disable-next-line no-console
		console[ timerMethod ]( this.config.timerLabel );
	}
}

new Screenshot();
