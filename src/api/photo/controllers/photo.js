'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// @ts-ignore
module.exports = createCoreController('api::photo.photo', ({ strapi }) => ({
  async create(ctx) {
    const { data } = ctx.request.body;
    const user = ctx.state.user;

    // Debug authentication
    console.log('📸 Photo upload request received');
    console.log('User from ctx.state.user:', user ? `ID: ${user.id}, Username: ${user.username}` : 'No user');
    console.log('Authorization header:', ctx.request.header.authorization ? 'Present' : 'Missing');
    console.log('Token preview:', ctx.request.header.authorization?.substring(0, 50) + '...');

    // Ensure user is authenticated
    if (!user) {
      console.log('❌ No authenticated user found');
      return ctx.unauthorized('You must be logged in to upload photos');
    }

    try {
      let imageFile = null;
      
      // Handle base64 image upload
      if (data.image && typeof data.image === 'string' && data.image.startsWith('data:')) {
        try {
          console.log('Processing base64 image upload...');
          
          // Convert base64 to buffer
          const base64Data = data.image.split(',')[1];
          const buffer = Buffer.from(base64Data, 'base64');
          console.log('Base64 data length:', base64Data.length);
          console.log('Buffer size:', buffer.length);
          
          // Get file extension from base64 header
          const mimeType = data.image.split(',')[0].split(':')[1].split(';')[0];
          const extension = mimeType.split('/')[1] || 'jpg';
          console.log('MIME type:', mimeType, 'Extension:', extension);
          
          // Create filename and save directly to uploads directory
          const fileName = `photo_${Date.now()}.${extension}`;
          const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
          
          // Ensure uploads directory exists
          if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
          }
          
          const filePath = path.join(uploadsDir, fileName);
          console.log('Saving file to:', filePath);
          
          // Write buffer to file
          fs.writeFileSync(filePath, buffer);
          console.log('File saved successfully');
          
          // Create file record manually
          // @ts-ignore
          const fileRecord = await strapi.entityService.create('plugin::upload.file', {
            data: {
              name: fileName,
              alternativeText: null,
              caption: null,
              width: null,
              height: null,
              formats: null,
              hash: `photo_${Date.now()}`,
              ext: `.${extension}`,
              mime: mimeType,
              size: buffer.length,
              url: `/uploads/${fileName}`,
              previewUrl: null,
              provider: 'local',
              provider_metadata: null,
              folderPath: '/',
              folder: null
            }
          });
          
          imageFile = fileRecord;
          console.log('File record created successfully:', imageFile.id);
        } catch (error) {
          console.error('Error uploading base64 image:', error);
          console.error('Error stack:', error.stack);
          return ctx.badRequest('Failed to process image: ' + error.message);
        }
      }

      // Set photo data with authenticated user
      const photoData = {
        ...data,
        image: imageFile ? imageFile.id : data.image,
        author: user.id, // Set author to authenticated user ID
        status: data.status || 'pending', // Use provided status or default to pending for admin approval
        uploaded_at: data.uploaded_at || new Date(),
        approved_at: data.approved_at || null
      };

      // Process image to get dimensions and orientation
      if (imageFile) {
        try {
          // Read the file directly from the filesystem since we saved it there
          const filePath = path.join(process.cwd(), 'public', imageFile.url);
          
          if (fs.existsSync(filePath)) {
            const imageBuffer = fs.readFileSync(filePath);
            const metadata = await sharp(imageBuffer).metadata();
            
            photoData.width = metadata.width;
            photoData.height = metadata.height;
            
            // Determine orientation
            if (metadata.width > metadata.height) {
              photoData.orientation = 'landscape';
            } else if (metadata.height > metadata.width) {
              photoData.orientation = 'portrait';
            } else {
              photoData.orientation = 'square';
            }
          }
        } catch (error) {
          console.error('Error processing image metadata:', error);
        }
      }

      // @ts-ignore
      const photo = await strapi.entityService.create('api::photo.photo', {
        data: photoData,
        populate: ['author', 'hashtags', 'image']
      });

      return ctx.created({ data: photo });
    } catch (error) {
      console.error('Error creating photo:', error);
      return ctx.badRequest('Failed to create photo');
    }
  },

  async find(ctx) {
    const { query } = ctx;
    
    // Only show approved photos to public
    const filters = Object.assign({}, query.filters || {}, {
      status: { $eq: 'approved' }
    });

    // @ts-ignore
    const photos = await strapi.entityService.findMany('api::photo.photo', Object.assign({}, query, {
      filters,
      populate: ['author', 'hashtags', 'image']
    }));

    return { data: photos };
  },

  async findOne(ctx) {
    const { id } = ctx.params;
    
    // @ts-ignore
    const photo = await strapi.entityService.findOne('api::photo.photo', id, {
      populate: ['author', 'hashtags', 'image']
    });

    // @ts-ignore
    if (!photo || photo.status !== 'approved') {
      return ctx.notFound('Photo not found');
    }

    // Increment view count
    // @ts-ignore
    await strapi.entityService.update('api::photo.photo', id, {
      // @ts-ignore
      data: { views: (photo.views || 0) + 1 }
    });

    return { data: photo };
  },

  async like(ctx) {
    const { id } = ctx.params;
    const user = ctx.state.user;

    if (!user) {
      return ctx.unauthorized('You must be logged in to like photos');
    }

    try {
      // @ts-ignore
      const photo = await strapi.entityService.findOne('api::photo.photo', id);
      
      if (!photo) {
        return ctx.notFound('Photo not found');
      }

      // TODO: Implement like tracking to prevent duplicate likes
      // For now, just increment the like count
      // @ts-ignore
      const updatedPhoto = await strapi.entityService.update('api::photo.photo', id, {
        // @ts-ignore
        data: { likes: (photo.likes || 0) + 1 }
      });

      return { data: updatedPhoto };
    } catch (error) {
      console.error('Error liking photo:', error);
      return ctx.badRequest('Failed to like photo');
    }
  },

  async approve(ctx) {
    const { id } = ctx.params;
    const user = ctx.state.user;

    console.log('📸 ===== PHOTO APPROVAL REQUEST =====');
    console.log('📸 Photo ID:', id);
    console.log('👤 User:', user ? `ID: ${user.id}, Username: ${user.username}, Role: ${user.role?.name || user.role?.type || 'unknown'}` : 'No user');
    console.log('🔐 Auth header present:', !!ctx.request.header.authorization);
    console.log('📋 Request body:', JSON.stringify(ctx.request.body, null, 2));

    if (!user) {
      console.log('❌ No authenticated user found');
      return ctx.forbidden('Authentication required');
    }
    
    // Check if user is admin (by role name or type)
    const isAdmin = user.role?.name === 'admin' || user.role?.type === 'admin' || user.role === 'admin';
    console.log('🔐 Admin check:', { 
      roleName: user.role?.name, 
      roleType: user.role?.type, 
      role: user.role, 
      isAdmin 
    });
    
    if (!isAdmin) {
      console.log('❌ User is not admin:', user.role);
      return ctx.forbidden('Only admins can approve photos');
    }

    try {
      console.log('🔍 Fetching existing photo...');
      // First check if photo exists
      // @ts-ignore
      const existingPhoto = await strapi.entityService.findOne('api::photo.photo', id, {
        populate: ['author', 'image']
      });
      
      if (!existingPhoto) {
        console.log('❌ Photo not found:', id);
        return ctx.notFound('Photo not found');
      }

      console.log('📸 Current photo details:', {
        id: existingPhoto.id,
        status: existingPhoto.status,
        caption: existingPhoto.caption,
        author: existingPhoto.author?.username || existingPhoto.author,
        uploaded_at: existingPhoto.uploaded_at,
        approved_at: existingPhoto.approved_at,
        rejected_at: existingPhoto.rejected_at
      });

      console.log('🔄 Updating photo status to approved...');
      // @ts-ignore
      const photo = await strapi.entityService.update('api::photo.photo', id, {
        data: { 
          // @ts-ignore
          status: 'approved',
          approved_at: new Date()
        }
      });

      console.log('✅ Photo approved successfully!');
      console.log('📸 Updated photo details:', {
        id: photo.id,
        status: photo.status,
        approved_at: photo.approved_at,
        rejected_at: photo.rejected_at
      });
      console.log('📸 ===== APPROVAL COMPLETE =====');
      
      return { data: photo };
    } catch (error) {
      console.error('❌ Error approving photo:', error);
      console.error('❌ Error stack:', error.stack);
      return ctx.badRequest('Failed to approve photo: ' + error.message);
    }
  },

  async reject(ctx) {
    const { id } = ctx.params;
    const user = ctx.state.user;
    const { reason } = ctx.request.body;

    if (!user) {
      return ctx.forbidden('Authentication required');
    }
    
    // Check if user is admin (by role name or type)
    const isAdmin = user.role?.name === 'admin' || user.role?.type === 'admin' || user.role === 'admin';
    if (!isAdmin) {
      return ctx.forbidden('Only admins can reject photos');
    }

    try {
      // @ts-ignore
      const photo = await strapi.entityService.update('api::photo.photo', id, {
        data: { 
          // @ts-ignore
          status: 'rejected',
          rejected_at: new Date(),
          rejection_reason: reason
        }
      });

      return { data: photo };
    } catch (error) {
      console.error('Error rejecting photo:', error);
      return ctx.badRequest('Failed to reject photo');
    }
  },

  async getLatest(ctx) {
    const { limit = 1 } = ctx.query;
    
    try {
      // @ts-ignore
      const photos = await strapi.entityService.findMany('api::photo.photo', {
        filters: { status: { $eq: 'approved' } },
        sort: { uploaded_at: 'desc' },
        limit: parseInt(String(limit)),
        populate: ['author', 'hashtags', 'image']
      });

      return { data: photos };
    } catch (error) {
      console.error('Error in getLatest:', error);
      return { data: [] };
    }
  },

  async getTrending(ctx) {
    const { limit = 10 } = ctx.query;
    
    // @ts-ignore
    const photos = await strapi.entityService.findMany('api::photo.photo', {
      filters: { status: { $eq: 'approved' } },
      sort: { likes: 'desc' },
      limit: parseInt(String(limit)),
      populate: ['author', 'hashtags', 'image']
    });

    return { data: photos };
  },

  async getPending(ctx) {
    try {
      console.log('📸 Getting pending photos...');
      
      // @ts-ignore
      const photos = await strapi.entityService.findMany('api::photo.photo', {
        filters: { status: { $eq: 'pending' } },
        sort: { uploaded_at: 'desc' },
        populate: ['author', 'hashtags', 'image']
      });

      console.log(`📸 Found ${photos.length} pending photos`);
      return { data: photos };
    } catch (error) {
      console.error('❌ Error in getPending:', error);
      return ctx.badRequest('Failed to get pending photos: ' + error.message);
    }
  },

  async debugPhoto(ctx) {
    const { id } = ctx.params;
    
    console.log('🔍 ===== PHOTO DEBUG REQUEST =====');
    console.log('🔍 Photo ID:', id);
    
    try {
      // @ts-ignore
      const photo = await strapi.entityService.findOne('api::photo.photo', id, {
        populate: ['author', 'hashtags', 'image']
      });

      if (!photo) {
        console.log('❌ Photo not found:', id);
        return ctx.notFound('Photo not found');
      }

      console.log('📸 Photo found:', {
        id: photo.id,
        status: photo.status,
        caption: photo.caption,
        author: photo.author?.username || photo.author,
        uploaded_at: photo.uploaded_at,
        approved_at: photo.approved_at,
        rejected_at: photo.rejected_at,
        rejection_reason: photo.rejection_reason,
        likes: photo.likes,
        views: photo.views,
        featured: photo.featured,
        image: photo.image ? 'Present' : 'Missing'
      });

      return { 
        // @ts-ignore
        data: {
          id: photo.id,
          // @ts-ignore
          status: photo.status,
          // @ts-ignore
          caption: photo.caption,
          // @ts-ignore
          uploaded_at: photo.uploaded_at,
          // @ts-ignore
          approved_at: photo.approved_at,
          // @ts-ignore
          rejected_at: photo.rejected_at,
          // @ts-ignore
          rejection_reason: photo.rejection_reason,
          // @ts-ignore
          author: photo.author?.username || photo.author,
          // @ts-ignore
          likes: photo.likes,
          // @ts-ignore
          views: photo.views,
          // @ts-ignore
          featured: photo.featured
        }
      };
    } catch (error) {
      console.error('❌ Error in debugPhoto:', error);
      console.error('❌ Error stack:', error.stack);
      return ctx.badRequest('Failed to get photo debug info: ' + error.message);
    }
  }
}));
